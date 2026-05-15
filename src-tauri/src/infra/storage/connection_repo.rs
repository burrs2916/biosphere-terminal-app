use crate::core::error::Result;
use crate::core::types::ConnectionConfig;
use crate::infra::storage::database::Database;

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
        Ok(connections)
    }

    pub fn save(db: &Database, config: &ConnectionConfig) -> Result<()> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO connections (id, name, connection_type, config_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                config.id,
                config.name,
                config.connection_type,
                config.config_json,
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
}
