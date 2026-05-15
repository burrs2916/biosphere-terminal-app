use crate::core::error::Result;
use crate::core::types::TerminalSession;
use crate::infra::storage::database::Database;

pub struct SessionRepo;

impl SessionRepo {
    pub fn list(db: &Database) -> Result<Vec<TerminalSession>> {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, profile_id, cwd, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
        )?;
        let sessions = stmt
            .query_map([], |row| {
                Ok(TerminalSession {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    profile_id: row.get(2)?,
                    cwd: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn save(db: &Database, session: &TerminalSession) -> Result<()> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, name, profile_id, cwd, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                session.id,
                session.name,
                session.profile_id,
                session.cwd,
                session.created_at,
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<()> {
        let conn = db.conn();
        conn.execute("DELETE FROM sessions WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}
