use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Instant;

use super::parser::HttpScript;
use super::template::render_template;
use super::safety::is_private_ip;
use super::executor::{ExecutionResult, ExecutionContext, http_client};

pub async fn execute_http(
    http_script: &HttpScript,
    params: &Value,
    ctx: &ExecutionContext,
    _workspace_dir: &PathBuf,
) -> ExecutionResult {
    let start = Instant::now();
    let (url, used_keys) = render_template(&http_script.url_template, params);

    if is_private_ip(&url) {
        return ExecutionResult {
            success: false,
            output: format!("HTTP request to private/internal IP address is blocked for security: {}. Only public internet URLs are allowed.", url),
            script_type: "http".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "tool": ctx.tool_name, "blocked": true, "url": url }),
        };
    }

    let mut remaining = serde_json::Map::new();
    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            if !used_keys.contains(key) && key != "method" && key != "headers" {
                remaining.insert(key.clone(), value.clone());
            }
        }
    }

    let client = match http_client() {
        Ok(c) => c,
        Err(e) => {
            return ExecutionResult {
                success: false,
                output: format!("Failed to build HTTP client: {}", e),
                script_type: "http".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata: json!({ "tool": ctx.tool_name, "error": e.to_string() }),
            };
        }
    };

    let mut request = match http_script.method.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => client.get(&url),
    };

    for (key, value) in &http_script.headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if !remaining.is_empty() && (http_script.method == "POST" || http_script.method == "PUT" || http_script.method == "PATCH") {
        request = request.json(&Value::Object(remaining));
    }

    match request.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let is_success = status >= 200 && status < 300;
            let body = resp.text().await.unwrap_or_else(|e| format!("Failed to read response body: {}", e));
            ExecutionResult {
                success: is_success,
                output: body,
                script_type: "http".to_string(),
                duration_ms: start.elapsed().as_millis() as i64,
                metadata: json!({ "status": status, "method": http_script.method, "url": url, "tool": ctx.tool_name }),
            }
        }
        Err(e) => ExecutionResult {
            success: false,
            output: format!("HTTP request failed: {}", e),
            script_type: "http".to_string(),
            duration_ms: start.elapsed().as_millis() as i64,
            metadata: json!({ "method": http_script.method, "url": url, "tool": ctx.tool_name }),
        },
    }
}
