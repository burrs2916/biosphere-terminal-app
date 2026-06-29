use crate::core::error::Result;
use crate::core::types::CommandHistoryEntry;
use crate::domain::command::parser::CommandParser;
use crate::infra::storage::database::Database;
use crate::infra::storage::command_repo::CommandRepo;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct CommandExecutor {
    db: Arc<Database>,
    parser: CommandParser,
    app_handle: Option<AppHandle>,
}

impl CommandExecutor {
    pub fn new(db: Arc<Database>, app_handle: AppHandle) -> Self {
        CommandExecutor {
            db,
            parser: CommandParser::new(),
            app_handle: Some(app_handle),
        }
    }

    /// 只解析命令，不写入历史记录（用于命令面板预览）
    pub fn parse_only(&self, command: &str) -> Result<ParsedCommandResult> {
        let parsed = self.parser.parse(command);
        let is_dangerous = self.parser.is_dangerous(&parsed);

        Ok(ParsedCommandResult {
            entry_id: String::new(), // 空ID，表示未记录
            program: parsed.program,
            args: parsed.args,
            has_pipe: parsed.has_pipe,
            has_redirect: parsed.has_redirect,
            is_background: parsed.is_background,
            is_dangerous,
        })
    }

    /// 解析并记录命令到历史（用于终端实际执行）
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

        // 通知前端命令历史已更新
        if let Some(handle) = &self.app_handle {
            let _ = handle.emit("command-history-changed", &serde_json::json!({
                "id": entry.id,
                "command": entry.command,
            }));
        }

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
