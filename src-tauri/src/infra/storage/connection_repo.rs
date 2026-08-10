use crate::core::error::Result;
use crate::core::types::ConnectionConfig;
use crate::infra::security::crypto;
use crate::infra::storage::database::Database;
use serde_json::Value;

pub struct ConnectionRepo;

impl ConnectionRepo {
    pub fn list(db: &Database) -> Result<Vec<ConnectionConfig>> {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, connection_type, config_json, created_at FROM connections ORDER BY created_at DESC",
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(ConnectionConfig {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    connection_type: row.get(2)?,
                    config_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        // 解密每条连接的密码，使下游消费方（测试 / 终端 Connect / 远程桌面）透明拿到明文
        let mut out = Vec::with_capacity(connections.len());
        for mut c in connections {
            c.config_json = decrypt_config_password(&c.config_json);
            out.push(c);
        }
        Ok(out)
    }

    pub fn save(db: &Database, config: &ConnectionConfig) -> Result<()> {
        // 入库前加密密码字段
        let encrypted_json = encrypt_config_password(&config.config_json);
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO connections (id, name, connection_type, config_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                config.id,
                config.name,
                config.connection_type,
                encrypted_json,
                config.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<()> {
        let conn = db.conn();
        conn.execute("DELETE FROM connections WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<ConnectionConfig>> {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, connection_type, config_json, created_at FROM connections WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(ConnectionConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                connection_type: row.get(2)?,
                config_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(row) => {
                let mut c = row?;
                c.config_json = decrypt_config_password(&c.config_json);
                Ok(Some(c))
            }
            None => Ok(None),
        }
    }
}

/// 解析 config_json，对未加密的顶层 `password` 字段做 AES 加密。
/// 非 JSON / 解析失败 / 加密失败均原样保留，保证不破坏存储。
fn encrypt_config_password(config_json: &str) -> String {
    let mut value: Value = match serde_json::from_str(config_json) {
        Ok(v) => v,
        Err(_) => return config_json.to_string(),
    };
    if let Some(obj) = value.as_object_mut() {
        if let Some(Value::String(pw)) = obj.get("password") {
            if !pw.starts_with("enc::") {
                match crypto::encrypt_value(pw) {
                    Ok(enc) => {
                        obj.insert("password".to_string(), Value::String(enc));
                    }
                    Err(e) => {
                        tracing::warn!("[connection_repo] 加密密码失败，按明文存储: {}", e);
                    }
                }
            }
        }
    }
    serde_json::to_string(&value).unwrap_or_else(|_| config_json.to_string())
}

/// 解析 config_json，对 `enc::` 前缀的顶层 `password` 字段做 AES 解密。
/// 解密失败按原密文返回，避免一条坏数据拖垮整个列表。
fn decrypt_config_password(config_json: &str) -> String {
    let mut value: Value = match serde_json::from_str(config_json) {
        Ok(v) => v,
        Err(_) => return config_json.to_string(),
    };
    if let Some(obj) = value.as_object_mut() {
        if let Some(Value::String(pw)) = obj.get("password") {
            if pw.starts_with("enc::") {
                match crypto::decrypt_value(pw) {
                    Ok(dec) => {
                        obj.insert("password".to_string(), Value::String(dec));
                    }
                    Err(e) => {
                        tracing::warn!("[connection_repo] 解密密码失败，保留密文: {}", e);
                    }
                }
            }
        }
    }
    serde_json::to_string(&value).unwrap_or_else(|_| config_json.to_string())
}
