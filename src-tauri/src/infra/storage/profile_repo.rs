use crate::core::error::Result;
use crate::core::types::TerminalProfile;
use crate::infra::storage::database::Database;

pub struct ProfileRepo;

impl ProfileRepo {
    pub fn list(db: &Database) -> Result<Vec<TerminalProfile>> {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, config_json, is_default, created_at FROM profiles ORDER BY created_at DESC",
        )?;
        let profiles = stmt
            .query_map([], |row| {
                Ok(TerminalProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    config_json: row.get(2)?,
                    is_default: row.get::<_, i32>(3)? != 0,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(profiles)
    }

    pub fn save(db: &Database, profile: &TerminalProfile) -> Result<()> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO profiles (id, name, config_json, is_default, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                profile.id,
                profile.name,
                profile.config_json,
                profile.is_default as i32,
                profile.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<()> {
        let conn = db.conn();
        conn.execute("DELETE FROM profiles WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}
