use crate::core::error::Result;
use crate::core::types::ConnectionConfig;
use crate::infra::storage::database::Database;
use crate::infra::storage::connection_repo::ConnectionRepo;

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
}
