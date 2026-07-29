//! 连接密码的静态加密 (at-rest encryption)。
//!
//! 设计原则（对齐用户的硬约束：跨平台、零额外安装）：
//! - 使用纯 Rust 的 `aes-gcm`，无系统依赖，不要求用户安装任何东西。
//! - 密钥在 app 启动时基于 data_dir 生成并落盘到 `cred.key`（与数据库同目录），
//!   权限 0600（Unix）。密钥由 app 自身持有，下游连接无需用户每次解锁。
//! - 加密集中在存储层的唯一读取/写入边界，三处消费方（测试 / 终端 Connect /
//!   远程桌面）拿到的仍是明文，连接行为完全不变。
//! - 存储格式：`<ENC_PREFIX><base64(nonce || ciphertext)>`；未加密的老数据原样返回。

use crate::core::error::{Error, Result};
use std::path::Path;
use std::sync::OnceLock;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

const KEY_FILE_NAME: &str = "cred.key";
const ENC_PREFIX: &str = "enc::";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

static KEY: OnceLock<Vec<u8>> = OnceLock::new();

/// 在 app 启动时调用一次。基于 `data_dir` 读取或生成加密密钥。
/// 多次调用安全（幂等）。失败返回 Err，但调用方应降级而非阻断 app 启动。
pub fn init(data_dir: &Path) -> Result<()> {
    if KEY.get().is_some() {
        return Ok(());
    }
    let key_path = data_dir.join(KEY_FILE_NAME);
    let key = load_or_create_key(&key_path)?;
    KEY.set(key)
        .map_err(|_| Error::Internal("crypto key already initialized".to_string()))?;
    Ok(())
}

fn load_or_create_key(path: &Path) -> Result<Vec<u8>> {
    if path.exists() {
        let raw = std::fs::read(path)
            .map_err(|e| Error::Internal(format!("无法读取密钥文件 {:?}: {}", path, e)))?;
        let hex = String::from_utf8_lossy(&raw).trim().to_string();
        let bytes = hex_decode(&hex)
            .map_err(|e| Error::Internal(format!("密钥文件损坏 {:?}: {}", path, e)))?;
        if bytes.len() != KEY_LEN {
            return Err(Error::Internal(format!(
                "密钥长度异常 {:?}: 期望 {} 字节，实际 {}",
                path,
                KEY_LEN,
                bytes.len()
            )));
        }
        return Ok(bytes);
    }

    // 首次运行：生成 32 字节随机密钥并落盘
    let mut key = vec![0u8; KEY_LEN];
    getrandom::getrandom(&mut key)
        .map_err(|e| Error::Internal(format!("生成密钥失败: {}", e)))?;
    let hex = hex_encode(&key);
    write_key_file(path, hex.as_bytes())?;
    Ok(key)
}

#[cfg(unix)]
fn write_key_file(path: &Path, contents: &[u8]) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, contents)
        .map_err(|e| Error::Internal(format!("无法写入密钥文件 {:?}: {}", path, e)))?;
    let perms = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perms)
        .map_err(|e| Error::Internal(format!("无法设置密钥文件权限 {:?}: {}", path, e)))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, contents: &[u8]) -> Result<()> {
    std::fs::write(path, contents)
        .map_err(|e| Error::Internal(format!("无法写入密钥文件 {:?}: {}", path, e)))?;
    Ok(())
}

/// 加密明文密码，返回带前缀的可存储字符串。
pub fn encrypt_value(plain: &str) -> Result<String> {
    let key = KEY
        .get()
        .ok_or_else(|| Error::Internal("crypto 未初始化，无法加密".to_string()))?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plain.as_bytes())
        .map_err(|e| Error::Internal(format!("密码加密失败: {}", e)))?;
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce);
    combined.extend_from_slice(&ciphertext);
    Ok(format!("{}{}", ENC_PREFIX, B64.encode(combined)))
}

/// 解密存储的密码。若非 `enc::` 前缀（老明文数据），原样返回。
pub fn decrypt_value(stored: &str) -> Result<String> {
    if !stored.starts_with(ENC_PREFIX) {
        return Ok(stored.to_string());
    }
    let key = KEY
        .get()
        .ok_or_else(|| Error::Internal("crypto 未初始化，无法解密".to_string()))?;
    let b64 = &stored[ENC_PREFIX.len()..];
    let combined = B64
        .decode(b64)
        .map_err(|e| Error::Internal(format!("密文 base64 解码失败: {}", e)))?;
    if combined.len() < NONCE_LEN {
        return Err(Error::Internal(
            "密文长度异常（短于 nonce）".to_string(),
        ));
    }
    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| Error::Internal(format!("密码解密失败（密钥不匹配或数据损坏）: {}", e)))?;
    String::from_utf8(plain).map_err(|e| Error::Internal(format!("解密结果非 UTF-8: {}", e)))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    if s.len() % 2 != 0 {
        return Err(Error::Internal("hex 字符串长度为奇数".to_string()));
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_val(bytes[i])?;
        let lo = hex_val(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Ok(out)
}

fn hex_val(c: u8) -> Result<u8> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(Error::Internal(format!("非法 hex 字符: {}", c as char))),
    }
}
