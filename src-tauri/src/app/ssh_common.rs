//! Shared building blocks for every native SSH consumer (SFTP and the
//! terminal). One implementation of host-key verification, authentication and
//! error classification so the two features cannot drift apart — notably they
//! share the same `known_hosts` file and the same TOFU semantics.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, Handler};
use russh::keys::{self, Algorithm, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};

use crate::core::types::SshConnectionInfo;
use crate::infra::logging::debug_log;

/// Wall-clock cap for the TCP connect + SSH handshake + auth phase.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How often the SSH layer probes an otherwise silent session, and how many
/// unanswered probes kill it. This is what turns "peer vanished" into an
/// error the retry logic can act on, instead of an operation that waits
/// forever on a half-dead TCP connection.
pub(crate) const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
pub(crate) const KEEPALIVE_MAX: usize = 3;

/// Failure raised from inside the SSH handshake, before a session exists.
#[derive(Debug)]
pub(crate) enum HandlerError {
    /// `check_server_key` found a recorded key that does not match. Carries
    /// the known_hosts detail so the caller can clear the stale entry and
    /// retry once.
    HostKeyChanged(String),
    /// known_hosts exists but could not be parsed. Refuse rather than
    /// silently downgrade to trust-on-first-use on a broken trust store.
    HostKeyUnusable(String),
    Russh(russh::Error),
}

impl From<russh::Error> for HandlerError {
    fn from(e: russh::Error) -> Self {
        HandlerError::Russh(e)
    }
}

/// russh client handler. Its only real job is the host-key decision; the
/// default `data`/`auth_banner` implementations are fine for both the SFTP
/// subsystem and an interactive shell.
#[derive(Clone)]
pub(crate) struct SshHostKeyHandler {
    pub host: String,
    pub port: u16,
}

impl Handler for SshHostKeyHandler {
    type Error = HandlerError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let pubkey = server_public_key.public_key();
        match keys::check_known_hosts(&self.host, self.port, &pubkey) {
            // Recorded and matching — the steady state after the first connect.
            Ok(true) => Ok(true),
            // Unknown host: trust on first use. A failure to *record* the key
            // must not block the connection; it only means the next connect
            // will prompt the decision again.
            Ok(false) => {
                if let Err(e) =
                    keys::known_hosts::learn_known_hosts(&self.host, self.port, &pubkey)
                {
                    tracing::warn!("[SSH] host key accepted but could not be recorded: {}", e);
                }
                debug_log::term(
                    "DEBUG",
                    "ssh",
                    "ssh-hostkey-tofu",
                    &format!("host={} port={} first use, key recorded", self.host, self.port),
                );
                Ok(true)
            }
            // Recorded for this host but a different key: a reinstall, an IP
            // reuse, or a man in the middle. Refuse and let the caller clear
            // the stale entry after an explicit retry.
            Err(keys::Error::KeyChanged { line }) => Err(HandlerError::HostKeyChanged(format!(
                "远端主机密钥已变更（known_hosts 第 {} 行记录的不是当前密钥）",
                line
            ))),
            Err(e) => Err(HandlerError::HostKeyUnusable(e.to_string())),
        }
    }
}

/// Baseline transport config shared by both consumers: Nagle off (SSH is a
/// request/response protocol; small replies must not sit in the kernel
/// buffer), keepalive probes to detect half-dead TCP, and no inactivity
/// timeout (idle sessions are legitimate; the consumers decide when they die).
pub(crate) fn ssh_config() -> client::Config {
    let mut cfg = client::Config::default();
    cfg.nodelay = true;
    cfg.keepalive_interval = Some(KEEPALIVE_INTERVAL);
    cfg.keepalive_max = KEEPALIVE_MAX;
    cfg.inactivity_timeout = None;
    cfg
}

/// Full handshake: TCP (async DNS, per-address attempts, host-key-change
/// clears the stale entry and retries once) then auth. Returns a live
/// authenticated handle.
pub(crate) async fn establish(ssh: &SshConnectionInfo) -> Result<Handle<SshHostKeyHandler>, String> {
    let cfg = Arc::new(ssh_config());
    let addrs: Vec<std::net::SocketAddr> =
        match tokio::net::lookup_host((ssh.host.as_str(), ssh.port)).await {
            Ok(it) => it.collect(),
            Err(e) => {
                return Err(format!(
                    "连接建立失败：无法解析主机名 {}（{}）",
                    ssh.host, e
                ))
            }
        };
    if addrs.is_empty() {
        return Err(format!("连接建立失败：无法解析主机名 {}", ssh.host));
    }

    let mut handle: Option<Handle<SshHostKeyHandler>> = None;
    let mut last_err: Option<String> = None;
    for addr in addrs {
        match timeout_connect(cfg.clone(), addr, ssh).await {
            Ok(h) => {
                handle = Some(h);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        }
    }
    let mut handle = handle.ok_or_else(|| {
        last_err.unwrap_or_else(|| format!("连接建立失败：无法连接到 {}:{}", ssh.host, ssh.port))
    })?;

    match ssh.auth_method.as_str() {
        "private_key" => auth_publickey(&mut handle, ssh).await?,
        _ => auth_password(&mut handle, ssh).await?,
    }
    Ok(handle)
}

/// One address attempt. A host-key change drops the stale known_hosts entry
/// and retries exactly once — the `ssh-keygen -R` flow, minus the subprocess.
async fn timeout_connect(
    cfg: Arc<client::Config>,
    addr: std::net::SocketAddr,
    ssh: &SshConnectionInfo,
) -> Result<Handle<SshHostKeyHandler>, String> {
    let attempt = || async {
        client::connect(cfg.clone(), addr, SshHostKeyHandler {
            host: ssh.host.clone(),
            port: ssh.port,
        })
        .await
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, attempt()).await {
        Ok(Ok(h)) => Ok(h),
        Ok(Err(HandlerError::HostKeyChanged(_detail))) => {
            debug_log::term(
                "INFO",
                "ssh",
                "ssh-hostkey-changed",
                &format!(
                    "host={} port={} clearing stale entries and retrying once",
                    ssh.host, ssh.port
                ),
            );
            crate::app::sftp_native::known_hosts::remove_entries(&ssh.host, ssh.port);
            match tokio::time::timeout(CONNECT_TIMEOUT, attempt()).await {
                Ok(Ok(h)) => Ok(h),
                Ok(Err(e)) => Err(classify_connect_error(e, ssh)),
                Err(_) => Err(timeout_message(ssh)),
            }
        }
        Ok(Err(e)) => Err(classify_connect_error(e, ssh)),
        Err(_) => Err(timeout_message(ssh)),
    }
}

fn timeout_message(ssh: &SshConnectionInfo) -> String {
    format!(
        "连接超时：无法在 {} 秒内连接到 {}:{}",
        CONNECT_TIMEOUT.as_secs(),
        ssh.host,
        ssh.port
    )
}

/// Authenticate with the stored password. The empty-password case is a
/// configuration problem, not an auth failure — say so.
pub(crate) async fn auth_password(
    handle: &mut Handle<SshHostKeyHandler>,
    ssh: &SshConnectionInfo,
) -> Result<(), String> {
    let password = ssh.password.clone().unwrap_or_default();
    if password.is_empty() {
        return Err("服务器要求输入密码，但此连接未保存密码".to_string());
    }
    match handle.authenticate_password(&ssh.username, password).await {
        Ok(result) if result.success() => {
            debug_log::term(
                "DEBUG",
                "ssh",
                "ssh-auth-ok",
                &format!("method=password user={}", ssh.username),
            );
            Ok(())
        }
        Ok(_) => Err("SSH 认证失败：密码被拒绝（Permission denied）".to_string()),
        Err(e) => Err(classify_russh_error(&e, ssh)),
    }
}

/// Authenticate with a private key file. RSA keys sign with SHA-2 explicitly —
/// every server from the last decade rejects the default SHA-1 signature.
pub(crate) async fn auth_publickey(
    handle: &mut Handle<SshHostKeyHandler>,
    ssh: &SshConnectionInfo,
) -> Result<(), String> {
    let path = ssh
        .private_key_path
        .clone()
        .ok_or_else(|| "未配置私钥路径".to_string())?;
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("无法读取私钥文件 {}: {}", path, e))?;
    let key = keys::decode_secret_key(&content, None).map_err(|e| {
        let low = e.to_string().to_lowercase();
        if low.contains("encrypted") || low.contains("passphrase") {
            "私钥已加密，需要口令（请改用未加密的密钥或先 ssh-add 到代理）".to_string()
        } else {
            format!("无法解析私钥 {}: {}", path, e)
        }
    })?;
    let hash_alg = match key.algorithm() {
        Algorithm::Rsa { .. } => Some(HashAlg::Sha256),
        _ => None,
    };
    let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
    match handle
        .authenticate_publickey(&ssh.username, key_with_hash)
        .await
    {
        Ok(result) if result.success() => {
            debug_log::term(
                "DEBUG",
                "ssh",
                "ssh-auth-ok",
                &format!("method=publickey user={} key={}", ssh.username, path),
            );
            Ok(())
        }
        Ok(_) => Err("SSH 认证失败：密钥被拒绝（Permission denied）".to_string()),
        Err(e) => Err(classify_russh_error(&e, ssh)),
    }
}

/// Classify a handshake-phase failure into the UI's five categories.
pub(crate) fn classify_connect_error(e: HandlerError, ssh: &SshConnectionInfo) -> String {
    match e {
        HandlerError::HostKeyChanged(detail) => {
            format!(
                "主机密钥校验失败：{} 与 known_hosts 中记录的不一致（host key changed）。\
                 如确认是主机重装/IP 复用，请删除旧记录后重试。",
                detail
            )
        }
        HandlerError::HostKeyUnusable(detail) => {
            format!("主机密钥校验失败：无法读取 known_hosts（{}）", detail)
        }
        HandlerError::Russh(err) => classify_russh_error(&err, ssh),
    }
}

/// Map a `russh::Error` onto the same categories, matching on the variant
/// where possible and on the rendered text for the io-flavoured ones (TCP
/// failures arrive wrapped).
pub(crate) fn classify_russh_error(err: &russh::Error, ssh: &SshConnectionInfo) -> String {
    use russh::Error::*;
    match err {
        NotAuthenticated | UnsupportedAuthMethod => {
            "SSH 认证失败：认证未通过（凭据不正确，或服务器禁用了该登录方式）".to_string()
        }
        _ => {
            let low = err.to_string().to_lowercase();
            if low.contains("connection refused") {
                format!(
                    "连接建立失败：无法连接到 {}:{}（connection refused，SSH 服务未运行或端口不对）",
                    ssh.host, ssh.port
                )
            } else if low.contains("no route") || low.contains("network is unreachable") {
                format!("连接建立失败：网络不可达（{}:{}）", ssh.host, ssh.port)
            } else if low.contains("name or service not known")
                || low.contains("failed to lookup")
                || low.contains("invalid socket address")
            {
                format!("连接建立失败：无法解析主机名 {}", ssh.host)
            } else if low.contains("timed out") || low.contains("timeout") {
                timeout_message(ssh)
            } else if low.contains("host key") {
                "主机密钥校验失败（host key verification failed）".to_string()
            } else if low.contains("permission denied") || low.contains("auth") {
                "SSH 认证失败：密码或密钥被拒绝（Permission denied）".to_string()
            } else {
                format!("SSH 连接失败：{}:{}（{}）", ssh.host, ssh.port, low)
            }
        }
    }
}

/// Dedicated runtime for SSH consumers (SFTP + terminal). One global instance:
/// both features need a place to run futures that a *blocking* thread can
/// enter safely, and Tauri's runtime workers must never be blocked on them.
static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();

fn runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("ssh-common")
            .enable_all()
            .build()
            .expect("ssh common runtime")
    })
}

/// Run a future on the dedicated runtime from *any* thread (a Tauri
/// `spawn_blocking` worker, an IPC thread) and block until it finishes.
/// Unlike `Handle::block_on` this never panics when the calling thread
/// happens to be inside another runtime, and it keeps the future `'static`
/// through the spawned indirection.
pub(crate) fn wait_on<T, F>(fut: F) -> Result<T, String>
where
    F: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    runtime().handle().clone().spawn(async move {
        let _ = tx.send(fut.await);
    });
    rx.recv().map_err(|_| "SSH 内部运行时已关闭".to_string())
}

/// Fire-and-forget spawn onto the dedicated runtime. For loops that run for
/// the lifetime of a session (output forwarding) — waiting on those would
/// block the caller forever.
pub(crate) fn spawn_on<F>(fut: F) -> Result<(), String>
where
    F: Future<Output = ()> + Send + 'static,
{
    // Spawn never fails for a Send future; the JoinHandle is detached on
    // purpose — these are session-lifetime loops, nobody awaits them.
    runtime().handle().clone().spawn(fut);
    Ok(())
}
