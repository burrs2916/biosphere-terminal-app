use crate::core::error::Result;
use crate::core::types::{CommandHistoryEntry, CommandSnippet};
use crate::infra::storage::database::Database;
use crate::infra::storage::command_repo::CommandRepo;

pub struct CommandService;

impl CommandService {
    pub fn get_history(db: &Database, limit: usize) -> Result<Vec<CommandHistoryEntry>> {
        CommandRepo::list(db, limit)
    }

    pub fn save_history(db: &Database, entry: &CommandHistoryEntry) -> Result<()> {
        CommandRepo::save(db, entry)
    }

    pub fn search_history(db: &Database, query: &str) -> Result<Vec<CommandHistoryEntry>> {
        CommandRepo::search(db, query)
    }

    pub fn list_snippets(db: &Database) -> Result<Vec<CommandSnippet>> {
        CommandRepo::list_snippets(db)
    }

    pub fn save_snippet(db: &Database, snippet: &CommandSnippet) -> Result<()> {
        CommandRepo::save_snippet(db, snippet)
    }

    pub fn delete_snippet(db: &Database, id: &str) -> Result<()> {
        CommandRepo::delete_snippet(db, id)
    }

    pub fn delete_history(db: &Database, id: &str) -> Result<()> {
        CommandRepo::delete_history(db, id)
    }

    pub fn clear_history(db: &Database) -> Result<()> {
        CommandRepo::clear_history(db)
    }

    pub fn delete_many(db: &Database, ids: &[String]) -> Result<()> {
        CommandRepo::delete_many(db, ids)
    }
}
