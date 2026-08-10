use crate::core::error::{Error, Result};
use crate::core::types::ConnectionConfig;
use crate::infra::storage::database::Database;
use crate::infra::storage::connection_repo::ConnectionRepo;
use serde_json::Value;

/// 远程桌面安装档位的合法取值。与前端 `InstallFlavor` 对齐。
const VALID_RD_FLAVORS: &[&str] = &["none", "minimal", "full"];

pub struct ConnectionService;

impl ConnectionService {
    pub fn list_connections(db: &Database) -> Result<Vec<ConnectionConfig>> {
        ConnectionRepo::list(db)
    }

    pub fn save_connection(db: &Database, config: &ConnectionConfig) -> Result<()> {
        ConnectionRepo::save(db, config)
    }

    pub fn delete_connection(db: &Database, id: &str) -> Result<()> {
        ConnectionRepo::delete(db, id)
    }

    pub fn get_connection(db: &Database, id: &str) -> Result<Option<ConnectionConfig>> {
        ConnectionRepo::get_by_id(db, id)
    }

    /// 读取该连接持久化的远程桌面安装档位（"none" | "minimal" | "full"）。
    /// 未设置 / 字段非法时返回 None，调用方回退到默认（full）。
    pub fn get_rd_install_flavor(db: &Database, id: &str) -> Result<Option<String>> {
        let conn = ConnectionRepo::get_by_id(db, id)?;
        let Some(conn) = conn else { return Ok(None) };
        let value: Value = serde_json::from_str(&conn.config_json).unwrap_or(Value::Null);
        match value.get("rd_install_flavor").and_then(|v| v.as_str()) {
            Some(f) if VALID_RD_FLAVORS.contains(&f) => Ok(Some(f.to_string())),
            _ => Ok(None),
        }
    }

    /// 把用户选择的远程桌面安装档位写回该连接的 config_json（持久化）。
    /// 非法档位直接报错，绝不写入脏值。
    pub fn set_rd_install_flavor(db: &Database, id: &str, flavor: &str) -> Result<()> {
        if !VALID_RD_FLAVORS.contains(&flavor) {
            return Err(Error::Connection(format!(
                "非法的安装档位: {flavor}（应为 none/minimal/full）"
            )));
        }
        let mut conn = match ConnectionRepo::get_by_id(db, id)? {
            Some(c) => c,
            None => return Err(Error::Connection(format!("连接不存在: {id}"))),
        };
        let mut value: Value = serde_json::from_str(&conn.config_json).unwrap_or(Value::Object(Default::default()));
        if let Some(obj) = value.as_object_mut() {
            obj.insert("rd_install_flavor".to_string(), Value::String(flavor.to_string()));
        }
        conn.config_json = serde_json::to_string(&value).unwrap_or_else(|_| conn.config_json);
        ConnectionRepo::save(db, &conn)
    }
}
