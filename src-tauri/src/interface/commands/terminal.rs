use crate::app::terminal_service::TerminalService;
use crate::core::types::PtyConfig;
use crate::infra::logging::debug_log;
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tauri::State;

/// Windows ConPTY init / resize and the PEB-read in `get_terminal_cwd` are OS
/// calls that can block or hang on Windows. Tauri runs synchronous commands on
/// the main (event-loop) thread, so a blocking call there freezes the ENTIRE
/// app UI. These commands therefore run their blocking core on a worker thread
/// via `spawn_blocking` so the UI thread stays responsive. `spawn_terminal`
/// additionally bounds ConPTY init with a 15s timeout so a hung spawn returns a
/// clean error instead of hanging the invoke forever.
#[tauri::command]
pub async fn spawn_terminal(
    session_id: String,
    config: PtyConfig,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    let svc = terminal_service.inner().clone();
    let sid = session_id.clone();
    debug_log::term(
        "DEBUG",
        "spawn",
        "request",
        &format!(
            "session={} conn_type={}",
            session_id,
            config.connection_type.as_deref().unwrap_or("local")
        ),
    );
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::task::spawn_blocking(move || svc.spawn(&session_id, &config)),
    )
    .await;
    match result {
        Ok(join) => match join {
            Ok(spawn_res) => match spawn_res {
                Ok(()) => {
                    debug_log::term("DEBUG", "spawn", "ok", &format!("session={}", sid));
                    Ok(())
                }
                Err(e) => {
                    debug_log::term(
                        "ERROR",
                        "spawn",
                        "failed",
                        &format!("session={} err={}", sid, e),
                    );
                    Err(e.to_string())
                }
            },
            Err(e) => {
                debug_log::term(
                    "ERROR",
                    "spawn",
                    "join-error",
                    &format!("session={} err={}", sid, e),
                );
                Err(format!("本地终端启动任务异常: {}", e))
            }
        },
        Err(_) => {
            debug_log::term(
                "ERROR",
                "spawn",
                "timeout",
                &format!(
                    "session={} timeoutMs=15000 hint=ConPTY init hung; app stays responsive, killing any partial session",
                    sid
                ),
            );
            // Best-effort cleanup of a session that may have been created after
            // the timeout fired. Harmless if spawn_blocking hasn't inserted yet.
            // Runs on a worker thread: `kill` takes the session + pty locks and
            // must not block a tokio worker.
            let cleanup_svc = terminal_service.inner().clone();
            let cleanup_sid = sid.clone();
            let _ = tokio::task::spawn_blocking(move || {
                cleanup_svc.kill(&cleanup_sid)
            })
            .await;
            Err("本地终端启动超时（Windows ConPTY 初始化无响应），请重试或检查终端设置".to_string())
        }
    }
}

#[tauri::command]
pub async fn write_to_terminal(
    session_id: String,
    data: Vec<u8>,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<usize, String> {
    let svc = terminal_service.inner().clone();
    match tokio::task::spawn_blocking(move || svc.write(&session_id, &data)).await {
        Ok(w) => w.map_err(|e| e.to_string()),
        Err(e) => Err(format!("写终端任务异常: {}", e)),
    }
}

#[tauri::command]
pub async fn kill_terminal(
    session_id: String,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    let svc = terminal_service.inner().clone();
    match tokio::task::spawn_blocking(move || svc.kill(&session_id)).await {
        Ok(k) => k.map_err(|e| e.to_string()),
        Err(e) => Err(format!("关闭终端任务异常: {}", e)),
    }
}

#[tauri::command]
pub async fn resize_terminal(
    session_id: String,
    rows: u16,
    cols: u16,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<(), String> {
    let svc = terminal_service.inner().clone();
    match tokio::task::spawn_blocking(move || svc.resize(&session_id, rows, cols)).await {
        Ok(r) => r.map_err(|e| e.to_string()),
        Err(e) => Err(format!("调整终端任务异常: {}", e)),
    }
}

#[tauri::command]
pub async fn relay_execute_command(command: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    app_handle
        .emit(
            "execute-command",
            serde_json::json!({
                "command": command,
            }),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_terminal_cwd(
    session_id: String,
    terminal_service: State<'_, Arc<TerminalService>>,
) -> Result<Option<String>, String> {
    let svc = terminal_service.inner().clone();
    match tokio::task::spawn_blocking(move || svc.get_cwd(&session_id)).await {
        Ok(c) => c.map_err(|e| e.to_string()),
        Err(e) => Err(format!("读取终端目录任务异常: {}", e)),
    }
}

/// 把本地文件复制到指定目录（"上传到当前目录"的本地会话路径）。
///
/// 纯文件 IO，阻塞 —— 必须走 `spawn_blocking`，绝不留在主线程
/// （同步 command 的任何阻塞调用都会钉死整个 app，见模块头注释）。
/// 逐文件复制，同名覆盖；源必须是已存在的普通文件。
#[tauri::command]
pub async fn local_copy_files(
    local_paths: Vec<String>,
    dest_dir: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let dest = std::path::Path::new(&dest_dir);
        if !dest.is_dir() {
            return Err(format!("目标目录不存在: {}", dest_dir));
        }
        for src in &local_paths {
            let p = std::path::Path::new(src);
            if !p.is_file() {
                return Err(format!("源不是文件或不存在: {}", src));
            }
            let name = p
                .file_name()
                .ok_or_else(|| format!("无效的文件路径: {}", src))?;
            let to = dest.join(name);
            std::fs::copy(p, &to).map_err(|e| format!("复制失败 {}: {}", src, e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("本地复制任务异常: {}", e))?
}

/// 确保本地目录存在（SFTP 在线编辑的临时目录准备步骤）。
#[tauri::command]
pub async fn ensure_local_dir(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败 {}: {}", path, e))
    })
    .await
    .map_err(|e| format!("创建目录任务异常: {}", e))?
}

/// 读取本地文本文件内容（SFTP 在线编辑的取稿路径）。
///
/// 仅接受 UTF-8 文本：二进制或 GBK 等其他编码一律拒绝——在线编辑回传是
/// 整文件覆盖，编码误判会把远端文件写坏，宁可拒开。BOM 作为合法 UTF-8
/// 字符保留在字符串里，写回时原样带回，round-trip 无损。
#[tauri::command]
pub async fn read_local_text_file(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)
            .map_err(|e| format!("无法读取文件信息 {}: {}", path, e))?;
        if !meta.is_file() {
            return Err(format!("不是普通文件: {}", path));
        }
        const MAX_TEXT_EDIT_BYTES: u64 = 8 * 1024 * 1024;
        if meta.len() > MAX_TEXT_EDIT_BYTES {
            return Err(format!(
                "文件过大（{} 字节），在线编辑仅支持 8MB 以内的文本文件",
                meta.len()
            ));
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("读取失败 {}: {}", path, e))?;
        String::from_utf8(bytes).map_err(|_| {
            "文件不是 UTF-8 文本（可能是二进制文件或 GBK 等其他编码），为避免损坏不支持在线编辑".to_string()
        })
    })
    .await
    .map_err(|e| format!("读取文本文件任务异常: {}", e))?
}

/// 把编辑后的内容写回本地临时文件（SFTP 在线编辑的存稿路径）。
/// 路径来自应用自己的临时目录，但仍确保父目录存在；写失败必须报错，
/// 因为后续上传以这个文件为准。
#[tauri::command]
pub async fn write_local_text_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&path, content).map_err(|e| format!("写入失败 {}: {}", path, e))
    })
    .await
    .map_err(|e| format!("写入文本文件任务异常: {}", e))?
}

/// 删除本地目录（SFTP 在线编辑的 scratch 目录清理）。
///
/// 护栏：只允许删除路径中含 `biosphere-sftp-edit` 组件的目录——这是本功能
/// 专用的 temp 区，之外的任何路径一律拒绝，防止前端 bug 变成误删事故。
#[tauri::command]
pub async fn remove_local_dir(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let guarded = p
            .components()
            .any(|c| c.as_os_str().to_string_lossy() == "biosphere-sftp-edit");
        if !guarded {
            return Err(format!("拒绝删除：目录不在 scratch 区内 {}", path));
        }
        if p.exists() {
            std::fs::remove_dir_all(p).map_err(|e| format!("删除目录失败 {}: {}", path, e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("删除目录任务异常: {}", e))?
}

/// Append a frontend-side Terminal diagnostic entry to `debug.log`.
///
/// The frontend half of a terminal session (WebGL renderer setup, output
/// chunk volume, `spawnTerminal` promise settlement) is where a Windows
/// "the whole app froze" report usually originates, and none of it is visible
/// in the `tracing` pipeline. Bridging it into the same `debug.log` as the
/// backend entries makes the two halves correlatable by the shared sequence
/// number.
///
/// Never fails and never blocks the caller: a logging hiccup must not change
/// terminal behaviour.
#[tauri::command]
pub fn append_terminal_log(level: String, phase: String, event: String, detail: String) {
    let normalized = match level.to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR",
        "WARN" => "WARN",
        "DEBUG" => "DEBUG",
        _ => "INFO",
    };
    debug_log::term_frontend(&normalized, &phase, &event, &detail);
}

#[cfg(test)]
mod tests {
    /// Guard against regressing a terminal command back to a *synchronous*
    /// Tauri command.
    ///
    /// Tauri runs a synchronous command on the main (event-loop) thread —
    /// official wording: "Commands without the *async* keyword are executed on
    /// the main thread unless defined with *#[tauri::command(async)]*". The
    /// terminal commands drive ConPTY, the Windows PEB read and the ssh
    /// client, all of which can block for seconds on Windows. Blocking the
    /// main thread there freezes the ENTIRE app (the reported "Windows local
    /// terminal freezes / the app dies" symptom).
    ///
    /// The only permitted synchronous command here is `append_terminal_log`,
    /// which does nothing but append one line to a file.
    #[test]
    fn no_terminal_command_blocks_the_main_thread() {
        let src = include_str!("terminal.rs");

        // Only the code before the test module is production code.
        let prod = src.split("#[cfg(test)]").next().unwrap();

        let mut offenders: Vec<String> = Vec::new();
        let mut lines = prod.lines().peekable();
        while let Some(line) = lines.next() {
            let trimmed = line.trim();
            if !trimmed.starts_with("#[tauri::command]") {
                continue;
            }
            // Find the signature that follows the attribute.
            let mut sig = String::new();
            for l in lines.by_ref() {
                let t = l.trim();
                if t.is_empty() || t.starts_with("//") || t.starts_with("///") {
                    continue;
                }
                sig = t.to_string();
                break;
            }
            if !sig.starts_with("pub fn ") {
                // `pub async fn` is safe: it is dispatched on the async runtime.
                continue;
            }
            let name = sig
                .trim_start_matches("pub fn ")
                .split('(')
                .next()
                .unwrap_or("")
                .trim();
            if name == "append_terminal_log" {
                continue;
            }
            offenders.push(format!("{name}: {sig}"));
        }

        assert!(
            offenders.is_empty(),
            "terminal commands must be `async` (or move their body into \
             `spawn_blocking`); a synchronous command runs on the main thread \
             and freezes the whole app on Windows. Offenders: {offenders:?}"
        );
    }

    /// `spawn_terminal` must keep a bounded timeout: a hung ConPTY init must
    /// return an error instead of hanging the invoke forever.
    #[test]
    fn spawn_terminal_has_a_bounded_timeout() {
        let src = include_str!("terminal.rs");
        let prod = src.split("#[cfg(test)]").next().unwrap();
        assert!(
            prod.contains("tokio::time::timeout"),
            "spawn_terminal must bound ConPTY init with a timeout"
        );
        assert!(
            prod.contains("tokio::task::spawn_blocking"),
            "spawn_terminal must run the blocking spawn on a worker thread"
        );
    }
}
