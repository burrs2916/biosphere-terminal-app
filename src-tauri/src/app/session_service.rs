use crate::core::error::Result;
use crate::core::types::TerminalSession;
use crate::infra::storage::database::Database;
use crate::infra::storage::session_repo::SessionRepo;

pub struct SessionService;

impl SessionService {
    pub fn list_sessions(db: &Database) -> Result<Vec<TerminalSession>> {
        SessionRepo::list(db)
    }

    pub fn create_session(db: &Database, session: &TerminalSession) -> Result<()> {
        SessionRepo::save(db, session)
    }

    pub fn delete_session(db: &Database, id: &str) -> Result<()> {
        SessionRepo::delete(db, id)
    }
}
