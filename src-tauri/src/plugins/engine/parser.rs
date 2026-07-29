use regex::Regex;
use std::sync::LazyLock;

static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{\{(\w+)\}\}").unwrap());

/// Detect `{{name}}` placeholders that were not substituted. `output_path` /
/// `workspace_dir` are injected by the engine and therefore never count as
/// unresolved from the caller's perspective.
pub fn detect_unresolved_placeholders(content: &str) -> Vec<String> {
    PLACEHOLDER_RE
        .captures_iter(content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .filter(|name| name != "output_path" && name != "workspace_dir")
        .collect()
}

#[derive(Debug, Clone)]
pub enum ScriptType {
    Http(HttpScript),
    Shell(ShellScript),
    ScriptFile(ScriptFileDef),
    Passthrough,
}

#[derive(Debug, Clone)]
pub struct HttpScript {
    pub method: String,
    pub url_template: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct ShellScript {
    pub command_template: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone)]
pub struct ScriptFileDef {
    pub interpreter: String,
    pub script_content: String,
    pub timeout_secs: u64,
}

pub fn parse_script(script: &str) -> ScriptType {
    let trimmed = script.trim();

    if let Some(rest) = trimmed.strip_prefix("script:") {
        let first_newline = rest.find('\n').unwrap_or(rest.len());
        let interpreter = rest[..first_newline].trim().to_string();
        let script_content = if first_newline < rest.len() {
            rest[first_newline + 1..].to_string()
        } else {
            String::new()
        };
        let interpreter_lower = interpreter.to_lowercase();
        let timeout_secs = if interpreter_lower.contains("python") || interpreter_lower.contains("node") {
            60
        } else {
            30
        };
        if interpreter.is_empty() {
            return ScriptType::Passthrough;
        }
        return ScriptType::ScriptFile(ScriptFileDef { interpreter, script_content, timeout_secs });
    }

    if let Some(cmd) = trimmed.strip_prefix("shell:") {
        let command_template = cmd.trim().to_string();
        let timeout_secs = if command_template.contains("convert") || command_template.contains("pandoc") || command_template.contains("wkhtmltopdf") {
            60
        } else {
            30
        };
        return ScriptType::Shell(ShellScript { command_template, timeout_secs });
    }

    if let Some(rest) = trimmed.strip_prefix("GET ")
        .or_else(|| trimmed.strip_prefix("POST "))
        .or_else(|| trimmed.strip_prefix("PUT "))
        .or_else(|| trimmed.strip_prefix("DELETE "))
        .or_else(|| trimmed.strip_prefix("PATCH "))
    {
        let method_end = trimmed.find(' ').unwrap_or(trimmed.len());
        let method = trimmed[..method_end].to_uppercase();

        let parts: Vec<&str> = rest.split('\n').collect();
        let url_template = parts.first().unwrap_or(&"").trim().to_string();

        if url_template.is_empty() || (!url_template.starts_with("http://") && !url_template.starts_with("https://")) {
            return ScriptType::Passthrough;
        }

        let mut headers = Vec::new();
        if parts.len() > 1 {
            for line in parts.iter().skip(1) {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once(':') {
                    headers.push((key.trim().to_string(), value.trim().to_string()));
                }
            }
        }

        ScriptType::Http(HttpScript { method, url_template, headers })
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let lines: Vec<&str> = trimmed.split('\n').collect();
        let url_template = lines.first().unwrap_or(&"").trim().to_string();

        let mut headers = Vec::new();
        if lines.len() > 1 {
            for line in lines.iter().skip(1) {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once(':') {
                    headers.push((key.trim().to_string(), value.trim().to_string()));
                }
            }
        }

        ScriptType::Http(HttpScript { method: "GET".to_string(), url_template, headers })
    } else if trimmed.contains("fetch(") || trimmed.contains("reqwest") {
        ScriptType::Passthrough
    } else {
        ScriptType::Passthrough
    }
}
