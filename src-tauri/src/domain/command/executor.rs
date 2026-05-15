use crate::core::error::Result;
use crate::core::types::CommandHistoryEntry;
use crate::domain::command::parser::CommandParser;
use crate::infra::storage::database::Database;
use crate::infra::storage::command_repo::CommandRepo;
use std::sync::Arc;

pub struct CommandExecutor {
    db: Arc<Database>,
    parser: CommandParser,
}

impl CommandExecutor {
    pub fn new(db: Arc<Database>) -> Self {
        CommandExecutor {
            db,
            parser: CommandParser::new(),
        }
    }

    pub fn parse_and_record(
        &self,
        command: &str,
        session_id: Option<&str>,
        cwd: &str,
    ) -> Result<ParsedCommandResult> {
        let parsed = self.parser.parse(command);
        let is_dangerous = self.parser.is_dangerous(&parsed);

        let entry = CommandHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.map(|s| s.to_string()),
            command: command.to_string(),
            cwd: cwd.to_string(),
            exit_code: None,
            executed_at: chrono_now_ms(),
            linked: false,
            linked_notes: Vec::new(),
        };

        CommandRepo::save(&self.db, &entry)?;

        Ok(ParsedCommandResult {
            entry_id: entry.id,
            program: parsed.program,
            args: parsed.args,
            has_pipe: parsed.has_pipe,
            has_redirect: parsed.has_redirect,
            is_background: parsed.is_background,
            is_dangerous,
        })
    }

    pub fn record_exit_code(&self, entry_id: &str, exit_code: i32) -> Result<()> {
        let db = &self.db;
        let conn = db.conn();
        conn.execute(
            "UPDATE command_history SET exit_code = ?1 WHERE id = ?2",
            rusqlite::params![exit_code, entry_id],
        )?;
        Ok(())
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCommandResult {
    pub entry_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub has_pipe: bool,
    pub has_redirect: bool,
    pub is_background: bool,
    pub is_dangerous: bool,
}
