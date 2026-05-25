use async_trait::async_trait;
use serde_json::{Value, json};
use std::process::Stdio;
use tokio::process::Command;

use super::engine::{AgentTool, ToolOutput};

pub struct TerminalTool {
    working_dir: Option<String>,
}

impl TerminalTool {
    pub fn new() -> Self {
        TerminalTool { working_dir: None }
    }

    #[allow(dead_code)]
    pub fn with_working_dir(mut self, dir: String) -> Self {
        self.working_dir = Some(dir);
        self
    }
}

#[async_trait]
impl AgentTool for TerminalTool {
    fn name(&self) -> &str {
        "terminal"
    }

    fn description(&self) -> &str {
        "Execute a shell command on the local system and return its output. Use this to run terminal commands, scripts, or system utilities."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout in seconds (default: 30, max: 120)"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let command = params["command"].as_str()
            .ok_or_else(|| "Missing 'command' parameter".to_string())?;

        let timeout_secs = params["timeout"].as_i64()
            .unwrap_or(30)
            .min(120)
            .max(1);

        let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
        let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

        let mut cmd = Command::new(shell);
        cmd.arg(flag)
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());

        if let Some(ref dir) = self.working_dir {
            cmd.current_dir(dir);
        }

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs as u64),
            cmd.output(),
        )
        .await
        .map_err(|_| format!("Command timed out after {} seconds", timeout_secs))?
        .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = String::from_utf8_lossy(&result.stdout).to_string();
        let stderr = String::from_utf8_lossy(&result.stderr).to_string();
        let exit_code = result.status.code().unwrap_or(-1);

        let success = result.status.success();
        let mut output_parts = Vec::new();

        if !stdout.is_empty() {
            output_parts.push(stdout);
        }
        if !stderr.is_empty() {
            output_parts.push(format!("[stderr]\n{}", stderr));
        }

        let output_text = if output_parts.is_empty() {
            format!("Command exited with code {}", exit_code)
        } else {
            output_parts.join("\n")
        };

        let truncated = if output_text.chars().count() > 8000 {
            let head: String = output_text.chars().take(8000).collect();
            format!("{}...\n[Output truncated, {} characters total]", head, output_text.chars().count())
        } else {
            output_text
        };

        Ok(ToolOutput {
            success,
            result: truncated,
            metadata: json!({
                "exit_code": exit_code,
            }),
        })
    }
}
