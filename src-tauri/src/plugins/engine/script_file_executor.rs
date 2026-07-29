use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Instant;

use super::parser::{ScriptFileDef, detect_unresolved_placeholders};
use super::template::render_template_with_workspace;
use super::safety::is_dangerous_command;
use super::executor::{ExecutionResult, ExecutionContext};

fn contains_non_utf8(data: &[u8]) -> bool {
    std::str::from_utf8(data).is_err()
}

fn safe_decode_output(data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(data) {
        return s.to_string();
    }
    let (cow, _, _) = encoding_rs::GBK.decode(data);
    if !cow.is_empty() {
        return cow.to_string();
    }
    String::from_utf8_lossy(data).to_string()
}

pub async fn execute_script_file(
    script_file: &ScriptFileDef,
    params: &Value,
    ctx: &ExecutionContext,
    workspace_dir: &PathBuf,
) -> ExecutionResult {
    let start = Instant::now();
    let (rendered_content, _) = render_template_with_workspace(&script_file.script_content, params, workspace_dir);

    if let Some(dangerous) = is_dangerous_command(&rendered_content) {
        return ExecutionResult {
            success: false,
            output: format!("Script rejected for safety: contains potentially dangerous pattern '{}'. If this is a legitimate script, please modify the plugin script.", dangerous),
            script_type: "script_file".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "script_file", "rejected": true }),
        };
    }

    let unresolved = detect_unresolved_placeholders(&rendered_content);
    if !unresolved.is_empty() {
        return ExecutionResult {
            success: false,
            output: format!(
                "Script contains unresolved parameter placeholders: {}. These parameters were not provided. Make sure all required parameters have values.",
                unresolved.iter().map(|p| format!("{{{{{}}}}}", p)).collect::<Vec<_>>().join(", ")
            ),
            script_type: "script_file".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({
                "tool": ctx.tool_name,
                "error_type": "unresolved_placeholders",
                "unresolved_params": unresolved,
            }),
        };
    }

    let interpreter_lower = script_file.interpreter.to_lowercase();
    let extension = if interpreter_lower.contains("python") {
        "py"
    } else if interpreter_lower.contains("node") || interpreter_lower.contains("js") {
        "js"
    } else if interpreter_lower.contains("ruby") || interpreter_lower.contains("rb") {
        "rb"
    } else if interpreter_lower.contains("perl") {
        "pl"
    } else {
        "sh"
    };

    let temp_dir = std::env::temp_dir().join("biosphere-scripts");
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return ExecutionResult {
            success: false,
            output: format!("Failed to create temp dir: {}", e),
            script_type: "script_file".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "tool": ctx.tool_name, "error": e.to_string() }),
        };
    }

    let file_name = format!("{}_{}.{}", ctx.tool_name, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis(), extension);
    let script_path = temp_dir.join(&file_name);

    if let Err(e) = std::fs::write(&script_path, &rendered_content) {
        return ExecutionResult {
            success: false,
            output: format!("Failed to write script file: {}", e),
            script_type: "script_file".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "tool": ctx.tool_name, "error": e.to_string() }),
        };
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&script_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&script_path, perms);
        }
    }

    let env_pythonio = if interpreter_lower.contains("python") {
        Some(("PYTHONIOENCODING".to_string(), "utf-8".to_string()))
    } else {
        None
    };

    let mut cmd = tokio::process::Command::new(&script_file.interpreter);
    cmd.arg(&script_path).current_dir(workspace_dir);

    if let Some((key, val)) = &env_pythonio {
        cmd.env(key, val);
    }
    cmd.env("PYTHONUTF8", "1");

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(script_file.timeout_secs),
        cmd.output()
    ).await;

    let _ = std::fs::remove_file(&script_path);

    match output {
        Ok(Ok(output)) => {
            let has_non_utf8_stdout = contains_non_utf8(&output.stdout);
            let has_non_utf8_stderr = contains_non_utf8(&output.stderr);

            let stdout = if has_non_utf8_stdout {
                safe_decode_output(&output.stdout)
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };
            let stderr = if has_non_utf8_stderr {
                safe_decode_output(&output.stderr)
            } else {
                String::from_utf8_lossy(&output.stderr).to_string()
            };

            let success = output.status.success();
            let exit_code = output.status.code().unwrap_or(-1);

            let stdout_empty = stdout.trim().is_empty();
            let stderr_empty = stderr.trim().is_empty();

            let mut warnings = Vec::new();

            if has_non_utf8_stdout || has_non_utf8_stderr {
                warnings.push("Output contained non-UTF-8 data (possibly binary or non-English encoding). Decoded with fallback.".to_string());
            }

            let result = if success {
                if stdout_empty && stderr_empty {
                    warnings.push("Script produced no output. Make sure you print results to stdout (not just to a file).".to_string());
                    format!("Script completed (exit code: {}) but produced NO OUTPUT. Check that your script prints results to stdout using print() or console.log().", exit_code)
                } else if stdout_empty && !stderr_empty {
                    warnings.push("stdout is empty but stderr has content. The script may be printing to stderr instead of stdout.".to_string());
                    format!("[WARNING: No stdout output. Showing stderr instead.]\n{}", stderr)
                } else if stderr_empty {
                    stdout
                } else {
                    format!("{}\n[stderr]: {}", stdout, stderr)
                }
            } else {
                format!("Script failed (exit code: {})\n{}\n[stderr]: {}", exit_code, stdout, stderr)
            };

            let mut metadata = json!({
                "plugin": true,
                "tool": ctx.tool_name,
                "script_type": "script_file",
                "interpreter": script_file.interpreter,
                "exit_code": exit_code,
                "stdout_empty": stdout_empty,
            });
            if !warnings.is_empty() {
                metadata["warnings"] = json!(warnings);
            }

            ExecutionResult {
                success,
                output: result,
                script_type: "script_file".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata,
            }
        }
        Ok(Err(e)) => {
            let interpreter = &script_file.interpreter;
            let suggestion = if interpreter.contains("python") {
                "Make sure Python 3 is installed: try running 'python3 --version' in your terminal."
            } else if interpreter.contains("node") {
                "Make sure Node.js is installed: try running 'node --version' in your terminal."
            } else {
                "Make sure the interpreter is installed and available in PATH."
            };
            ExecutionResult {
                success: false,
                output: format!("Failed to execute script with '{}': {}\n\n{}", interpreter, e, suggestion),
                script_type: "script_file".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "script_file", "interpreter": interpreter, "error": e.to_string() }),
            }
        }
        Err(_) => ExecutionResult {
            success: false,
            output: format!("Script timed out after {} seconds. If your script processes large files, consider optimizing it or breaking it into smaller steps.", script_file.timeout_secs),
            script_type: "script_file".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "plugin": true, "tool": ctx.tool_name, "script_type": "script_file", "timeout": true, "interpreter": script_file.interpreter }),
        },
    }
}
