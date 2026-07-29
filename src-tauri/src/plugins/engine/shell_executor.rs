use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Instant;

use super::parser::{ShellScript, detect_unresolved_placeholders};
use super::template::render_template_shell_safe;
use super::safety::is_dangerous_command;
use super::executor::{ExecutionResult, ExecutionContext};

pub async fn execute_shell(
    shell_script: &ShellScript,
    params: &Value,
    ctx: &ExecutionContext,
    workspace_dir: &PathBuf,
) -> ExecutionResult {
    let start = Instant::now();
    let (command, _) = render_template_shell_safe(&shell_script.command_template, params, workspace_dir);

    if let Some(dangerous) = is_dangerous_command(&command) {
        return ExecutionResult {
            success: false,
            output: format!("Command rejected for safety: contains potentially dangerous pattern '{}'. If this is a legitimate command, please modify the plugin script.", dangerous),
            script_type: "shell".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "shell", "rejected": true }),
        };
    }

    let unresolved = detect_unresolved_placeholders(&command);
    if !unresolved.is_empty() {
        return ExecutionResult {
            success: false,
            output: format!(
                "Shell command contains unresolved parameter placeholders: {}. These parameters were not provided. Make sure all required parameters have values.",
                unresolved.iter().map(|p| format!("{{{{{}}}}}", p)).collect::<Vec<_>>().join(", ")
            ),
            script_type: "shell".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({
                "tool": ctx.tool_name,
                "error_type": "unresolved_placeholders",
                "unresolved_params": unresolved,
            }),
        };
    }

    let (shell, shell_flag) = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(shell_script.timeout_secs),
        tokio::process::Command::new(shell)
            .arg(shell_flag)
            .arg(&command)
            .current_dir(workspace_dir)
            .output()
    ).await;

    match output {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let success = output.status.success();
            let exit_code = output.status.code().unwrap_or(-1);

            let stdout_empty = stdout.trim().is_empty();
            let stderr_empty = stderr.trim().is_empty();

            let mut warnings = Vec::new();

            let result = if success {
                if stdout_empty && stderr_empty {
                    warnings.push("Command produced no output.".to_string());
                    format!("Command completed (exit code: {}) but produced NO OUTPUT.", exit_code)
                } else if stdout_empty && !stderr_empty {
                    warnings.push("stdout is empty but stderr has content.".to_string());
                    format!("[WARNING: No stdout output. Showing stderr instead.]\n{}", stderr)
                } else if stderr_empty {
                    stdout
                } else {
                    format!("{}\n[stderr]: {}", stdout, stderr)
                }
            } else {
                format!("Command failed (exit code: {})\n{}\n[stderr]: {}", exit_code, stdout, stderr)
            };

            let mut metadata = json!({
                "plugin": true,
                "tool": ctx.tool_name,
                "script_type": "shell",
                "exit_code": exit_code,
                "command": command,
                "stdout_empty": stdout_empty,
            });
            if !warnings.is_empty() {
                metadata["warnings"] = json!(warnings);
            }

            ExecutionResult {
                success,
                output: result,
                script_type: "shell".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata,
            }
        }
        Ok(Err(e)) => ExecutionResult {
            success: false,
            output: format!("Failed to execute command: {}. Make sure the command and its dependencies are available.", e),
            script_type: "shell".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "shell", "command": command, "error": e.to_string() }),
        },
        Err(_) => ExecutionResult {
            success: false,
            output: format!("Command timed out after {} seconds. If this command processes large files, consider using 'script:' format with a longer timeout.", shell_script.timeout_secs),
            script_type: "shell".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "shell", "timeout": true, "command": command }),
        },
    }
}
