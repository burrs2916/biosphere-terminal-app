use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

use crate::app::terminal_service::TerminalService;
use super::engine::{AgentTool, ToolOutput};

pub struct TerminalSessionTool {
    terminal: Arc<TerminalService>,
}

impl TerminalSessionTool {
    pub fn new(terminal: Arc<TerminalService>) -> Self {
        TerminalSessionTool { terminal }
    }
}

#[async_trait]
impl AgentTool for TerminalSessionTool {
    fn name(&self) -> &str {
        "terminal_session"
    }

    fn description(&self) -> &str {
        "Interact with active terminal sessions: write commands to a session, read recent output, and check session status. Use this to run recovery commands in an existing terminal when a task is interrupted."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["write", "read_output", "list_sessions"],
                    "description": "Action: 'write' send a command to a terminal session, 'read_output' get recent output from a session, 'list_sessions' list active terminal sessions"
                },
                "session_id": {
                    "type": "string",
                    "description": "Terminal session ID (required for 'write' and 'read_output' actions)"
                },
                "command": {
                    "type": "string",
                    "description": "Command text to write (required for 'write' action)"
                },
                "lines": {
                    "type": "number",
                    "description": "Number of recent output lines to read (default: 50, max: 200, for 'read_output' action)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "write" => self.action_write(&params).await,
            "read_output" => self.action_read_output(&params).await,
            "list_sessions" => self.action_list_sessions().await,
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Available: write, read_output, list_sessions", action),
                metadata: Value::Null,
            }),
        }
    }
}

impl TerminalSessionTool {
    async fn action_write(&self, params: &Value) -> Result<ToolOutput, String> {
        let session_id = params["session_id"].as_str()
            .ok_or_else(|| "Missing 'session_id' parameter".to_string())?;
        let command = params["command"].as_str()
            .ok_or_else(|| "Missing 'command' parameter".to_string())?;

        let dangerous_patterns = ["rm -rf /", "mkfs", "dd if=", ":(){ :|:&", "> /dev/sd"];
        for pattern in dangerous_patterns {
            if command.contains(pattern) {
                return Ok(ToolOutput {
                    success: false,
                    result: format!("Command blocked for safety: contains dangerous pattern '{}'", pattern),
                    metadata: Value::Null,
                });
            }
        }

        let data = format!("{}\n", command);
        self.terminal.write(session_id, data.as_bytes())
            .map_err(|e| format!("Failed to write to session: {}", e))?;

        Ok(ToolOutput {
            success: true,
            result: format!("Sent command to session '{}': {}", session_id, command),
            metadata: json!({
                "sessionId": session_id,
                "command": command,
            }),
        })
    }

    async fn action_read_output(&self, params: &Value) -> Result<ToolOutput, String> {
        let session_id = params["session_id"].as_str()
            .ok_or_else(|| "Missing 'session_id' parameter".to_string())?;

        let lines = params["lines"].as_i64()
            .unwrap_or(50)
            .min(200)
            .max(1) as usize;

        let output = self.terminal.get_output_buffer(session_id, lines)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        Ok(ToolOutput {
            success: true,
            result: if output.is_empty() {
                format!("No output available for session '{}'", session_id)
            } else {
                let truncated = if output.chars().count() > 8000 {
                    let head: String = output.chars().take(8000).collect();
                    format!("{}...\n[Output truncated, {} characters total]", head, output.chars().count())
                } else {
                    output
                };
                format!("Output from session '{}' (last {} lines):\n{}", session_id, lines, truncated)
            },
            metadata: json!({
                "sessionId": session_id,
                "lines": lines,
            }),
        })
    }

    async fn action_list_sessions(&self) -> Result<ToolOutput, String> {
        let sessions = self.terminal.list_sessions().map_err(|e| e.to_string())?;

        let results: Vec<Value> = sessions.iter().map(|s| json!({
            "id": s,
        })).collect();

        Ok(ToolOutput {
            success: true,
            result: if results.is_empty() {
                "No active terminal sessions".to_string()
            } else {
                format!("Active sessions ({}):\n{}", results.len(),
                    results.iter().map(|r| format!("- {}", r["id"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": results }),
        })
    }
}
