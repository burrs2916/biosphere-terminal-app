use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

use crate::infra::storage::database::Database;
use crate::infra::storage::command_repo::CommandRepo;
use super::engine::{AgentTool, ToolOutput};

pub struct CommandHistoryTool {
    db: Arc<Database>,
}

impl CommandHistoryTool {
    pub fn new(db: Arc<Database>) -> Self {
        CommandHistoryTool { db }
    }
}

#[async_trait]
impl AgentTool for CommandHistoryTool {
    fn name(&self) -> &str {
        "command_history"
    }

    fn description(&self) -> &str {
        "Query command execution history: list recent commands, find failed commands, search by keyword, and get command details with linked notes. Essential for diagnosing terminal errors and recovering interrupted tasks."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list_recent", "list_failed", "search", "get_detail"],
                    "description": "Action: 'list_recent' show recent commands, 'list_failed' show commands with non-zero exit code, 'search' find commands by keyword, 'get_detail' get full details of a specific command"
                },
                "limit": {
                    "type": "number",
                    "description": "Max results (default: 10, max: 50)"
                },
                "query": {
                    "type": "string",
                    "description": "Search keyword (for 'search' action)"
                },
                "command_id": {
                    "type": "string",
                    "description": "Command ID (for 'get_detail' action)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        let limit = params["limit"].as_i64()
            .unwrap_or(10)
            .min(50)
            .max(1) as usize;

        match action {
            "list_recent" => self.action_list_recent(limit).await,
            "list_failed" => self.action_list_failed(limit).await,
            "search" => self.action_search(&params, limit).await,
            "get_detail" => self.action_get_detail(&params).await,
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Available: list_recent, list_failed, search, get_detail", action),
                metadata: Value::Null,
            }),
        }
    }
}

impl CommandHistoryTool {
    async fn action_list_recent(&self, limit: usize) -> Result<ToolOutput, String> {
        let entries = CommandRepo::list(&self.db, limit)
            .map_err(|e| e.to_string())?;

        let results: Vec<Value> = entries.iter().map(|e| {
            let exit_str = match e.exit_code {
                Some(0) => "OK".to_string(),
                Some(c) => format!("FAILED({})", c),
                None => "UNKNOWN".to_string(),
            };
            json!({
                "id": e.id,
                "command": e.command,
                "cwd": e.cwd,
                "exitCode": e.exit_code,
                "exitStatus": exit_str,
                "executedAt": e.executed_at,
                "linked": e.linked,
            })
        }).collect();

        Ok(ToolOutput {
            success: true,
            result: if results.is_empty() {
                "No command history found".to_string()
            } else {
                format!("Recent commands ({}):\n{}", results.len(),
                    results.iter().map(|r| format!("- [{}] {} (exit: {}, cwd: {})", r["id"], r["command"], r["exitStatus"], r["cwd"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": results }),
        })
    }

    async fn action_list_failed(&self, limit: usize) -> Result<ToolOutput, String> {
        let entries = CommandRepo::list(&self.db, 200)
            .map_err(|e| e.to_string())?;

        let failed: Vec<Value> = entries.iter()
            .filter(|e| e.exit_code.map_or(false, |c| c != 0))
            .take(limit)
            .map(|e| {
                json!({
                    "id": e.id,
                    "command": e.command,
                    "cwd": e.cwd,
                    "exitCode": e.exit_code,
                    "executedAt": e.executed_at,
                    "linkedNotes": e.linked_notes.iter().map(|n| json!({
                        "noteId": n.note_id,
                        "title": n.title,
                    })).collect::<Vec<_>>(),
                })
            }).collect();

        Ok(ToolOutput {
            success: true,
            result: if failed.is_empty() {
                "No failed commands found".to_string()
            } else {
                format!("Failed commands ({}):\n{}", failed.len(),
                    failed.iter().map(|r| format!("- [{}] {} (exit: {}, cwd: {})", r["id"], r["command"], r["exitCode"], r["cwd"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": failed }),
        })
    }

    async fn action_search(&self, params: &Value, limit: usize) -> Result<ToolOutput, String> {
        let query = params["query"].as_str()
            .ok_or_else(|| "Missing 'query' parameter for search".to_string())?;

        let entries = CommandRepo::search(&self.db, query)
            .map_err(|e| e.to_string())?;

        let results: Vec<Value> = entries.iter().take(limit).map(|e| {
            let exit_str = match e.exit_code {
                Some(0) => "OK".to_string(),
                Some(c) => format!("FAILED({})", c),
                None => "UNKNOWN".to_string(),
            };
            json!({
                "id": e.id,
                "command": e.command,
                "cwd": e.cwd,
                "exitCode": e.exit_code,
                "exitStatus": exit_str,
                "executedAt": e.executed_at,
            })
        }).collect();

        Ok(ToolOutput {
            success: true,
            result: if results.is_empty() {
                format!("No commands found matching '{}'", query)
            } else {
                format!("Found {} command(s) matching '{}':\n{}", results.len(), query,
                    results.iter().map(|r| format!("- [{}] {} (exit: {})", r["id"], r["command"], r["exitStatus"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": results }),
        })
    }

    async fn action_get_detail(&self, params: &Value) -> Result<ToolOutput, String> {
        let command_id = params["command_id"].as_str()
            .ok_or_else(|| "Missing 'command_id' parameter for get_detail".to_string())?;

        let entries = CommandRepo::list(&self.db, 500)
            .map_err(|e| e.to_string())?;

        let entry = entries.iter().find(|e| e.id == command_id)
            .ok_or_else(|| format!("Command '{}' not found", command_id))?;

        let linked_notes_str = if entry.linked_notes.is_empty() {
            "None".to_string()
        } else {
            entry.linked_notes.iter()
                .map(|n| format!("{} - {}", n.note_id, n.title))
                .collect::<Vec<_>>().join(", ")
        };

        let exit_str = match entry.exit_code {
            Some(0) => "Success (0)".to_string(),
            Some(c) => format!("Failed ({})", c),
            None => "Unknown".to_string(),
        };

        Ok(ToolOutput {
            success: true,
            result: format!(
                "Command Detail:\n  ID: {}\n  Command: {}\n  CWD: {}\n  Exit: {}\n  Executed: {}\n  Linked Notes: {}",
                entry.id, entry.command, entry.cwd, exit_str, entry.executed_at, linked_notes_str
            ),
            metadata: json!({
                "id": entry.id,
                "command": entry.command,
                "cwd": entry.cwd,
                "exitCode": entry.exit_code,
                "executedAt": entry.executed_at,
                "linkedNotes": entry.linked_notes.iter().map(|n| json!({
                    "noteId": n.note_id,
                    "title": n.title,
                    "category": n.category,
                    "groupId": n.group_id,
                })).collect::<Vec<_>>(),
            }),
        })
    }
}
