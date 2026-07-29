use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use super::parser::{ScriptType, parse_script};
use super::http_executor::execute_http;
use super::shell_executor::execute_shell;
use super::script_file_executor::execute_script_file;
use super::safety::is_private_ip;

/// A single shared HTTP client for all plugin HTTP calls. Building a
/// `reqwest::Client` per call (the previous behaviour) wastes a connection
/// pool and TLS configuration on every request.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn http_client() -> Result<reqwest::Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = HTTP_CLIENT.set(client.clone());
    Ok(client)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContext {
    pub tool_name: String,
    pub plugin_id: Option<String>,
    pub source: ExecutionSource,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionSource {
    Agent,
    User,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub success: bool,
    pub output: String,
    pub script_type: String,
    pub duration_ms: i64,
    pub metadata: Value,
}

pub async fn execute_script(
    script: &str,
    params: &Value,
    ctx: &ExecutionContext,
    workspace_dir: &PathBuf,
) -> ExecutionResult {
    let script_type = parse_script(script);

    match script_type {
        ScriptType::Http(ref http_script) => {
            execute_http(http_script, params, ctx, workspace_dir).await
        }
        ScriptType::Shell(ref shell_script) => {
            execute_shell(shell_script, params, ctx, workspace_dir).await
        }
        ScriptType::ScriptFile(ref script_file) => {
            execute_script_file(script_file, params, ctx, workspace_dir).await
        }
        ScriptType::Passthrough => {
            execute_passthrough(script, params, ctx).await
        }
    }
}

async fn execute_passthrough(script: &str, params: &Value, ctx: &ExecutionContext) -> ExecutionResult {
    let start = std::time::Instant::now();
    let trimmed = script.trim();

    if trimmed.contains("fetch(") {
        if let Some(url) = extract_url_from_fetch_script(trimmed) {
            let (resolved_url, _) = super::template::render_template(&url, params);

            if is_private_ip(&resolved_url) {
                return ExecutionResult {
                    success: false,
                    output: format!("HTTP request to private/internal IP address is blocked for security: {}. Only public internet URLs are allowed.", resolved_url),
                    script_type: "passthrough".to_string(),
                    duration_ms: start.elapsed().as_millis() as i64,
                    metadata: json!({ "tool": ctx.tool_name, "blocked": true, "url": resolved_url }),
                };
            }

            let client = match http_client() {
                Ok(c) => c,
                Err(e) => {
                    return ExecutionResult {
                        success: false,
                        output: format!("Failed to build HTTP client: {}", e),
                        script_type: "passthrough".to_string(),
                        duration_ms: start.elapsed().as_millis() as i64,
                        metadata: json!({ "tool": ctx.tool_name }),
                    };
                }
            };

            let method = if trimmed.contains("method: 'POST'") || trimmed.contains("method:\"POST\"") {
                "POST"
            } else {
                "GET"
            };

            let result = match method {
                "POST" => {
                    let body: Value = params.as_object()
                        .map(|obj| {
                            let mut m = serde_json::Map::new();
                            for (k, v) in obj {
                                if k != "url" && k != "method" {
                                    m.insert(k.clone(), v.clone());
                                }
                            }
                            Value::Object(m)
                        })
                        .unwrap_or(json!({}));
                    client.post(&resolved_url).json(&body).send().await
                }
                _ => client.get(&resolved_url).send().await,
            };

            match result {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let body = resp.text().await.unwrap_or_else(|e| e.to_string());
                    ExecutionResult {
                        success: status >= 200 && status < 300,
                        output: body,
                        script_type: "passthrough".to_string(),
                        duration_ms: start.elapsed().as_millis() as i64,
                        metadata: json!({ "status": status, "tool": ctx.tool_name }),
                    }
                }
                Err(e) => ExecutionResult {
                    success: false,
                    output: format!("Request failed: {}", e),
                    script_type: "passthrough".to_string(),
                    duration_ms: start.elapsed().as_millis() as i64,
                    metadata: json!({ "tool": ctx.tool_name }),
                },
            }
        } else {
            ExecutionResult {
                success: false,
                output: format!("Plugin tool '{}' has a fetch script but no valid URL could be extracted. Script: {}", ctx.tool_name, trimmed),
                script_type: "passthrough".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata: json!({ "tool": ctx.tool_name }),
            }
        }
    } else {
        ExecutionResult {
            success: false,
            output: format!(
                "Plugin tool '{}' has an unsupported script format. Supported formats:\n\
                 1. Shell command: 'shell: COMMAND' (e.g. 'shell: echo {{text}} > {{output_path}}')\n\
                 2. Script file: 'script: INTERPRETER\\nCODE' (e.g. 'script: python3\\nimport json\\n...')\n\
                 3. HTTP request: 'GET/POST/PUT/DELETE URL' or just a URL\n\
                 4. Fetch-like: JavaScript fetch() syntax\n\n\
                 Current script: {}",
                ctx.tool_name, trimmed
            ),
            script_type: "passthrough".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "tool": ctx.tool_name }),
        }
    }
}

fn extract_url_from_fetch_script(script: &str) -> Option<String> {
    if let Some(start) = script.find("fetch(") {
        let after_fetch = &script[start + 6..];
        let url_end = after_fetch.find(|c: char| c == ',' || c == ')').unwrap_or(after_fetch.len());
        let url_part = after_fetch[..url_end].trim();
        let url = url_part.trim_matches(|c| c == '\'' || c == '"' || c == '`');
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url.to_string());
        }
    }
    None
}
