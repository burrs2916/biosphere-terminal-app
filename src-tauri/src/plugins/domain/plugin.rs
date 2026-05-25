use serde::{Deserialize, Serialize};

use super::changelog::ChangelogEntry;
use super::ui_schema::UiSchema;
use super::ui_schema::ResultViewSpec;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub tools: Vec<PluginTool>,
    #[serde(default)]
    pub scenarios: Vec<PluginScenario>,
    #[serde(default)]
    pub trigger_keywords: Vec<String>,
    #[serde(default)]
    pub changelog: Vec<ChangelogEntry>,
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub category: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTool {
    pub name: String,
    pub description: String,
    pub parameters: Vec<ToolParameter>,
    pub script: String,
    #[serde(default)]
    pub ui_schema: Option<UiSchema>,
    #[serde(default)]
    pub result_view: Option<ResultViewSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolParameter {
    pub name: String,
    pub param_type: String,
    pub required: bool,
    pub description: String,
    pub default_value: Option<serde_json::Value>,
    #[serde(default)]
    pub ui_widget: Option<String>,
    #[serde(default)]
    pub ui_label: Option<String>,
    #[serde(default)]
    pub ui_placeholder: Option<String>,
    #[serde(default)]
    pub ui_options: Option<Vec<String>>,
    #[serde(default)]
    pub ui_accept: Option<String>,
    #[serde(default)]
    pub ui_group: Option<String>,
    #[serde(default)]
    pub ui_order: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScenario {
    pub name: String,
    pub description: String,
    pub example_prompt: String,
    #[serde(default = "default_scenario_category")]
    pub category: String,
    #[serde(default)]
    pub tool_name: String,
}

impl PluginScenario {
    pub fn sanitize(&mut self) {
        self.example_prompt = sanitize_example_prompt(&self.example_prompt);
    }
}

fn default_scenario_category() -> String {
    "practical".to_string()
}

fn sanitize_example_prompt(prompt: &str) -> String {
    let mut result = prompt.to_string();

    result = strip_bracket_instructions(&result);
    result = strip_absolute_paths(&result);
    result = strip_markdown_system_headers(&result);

    result = result.split_whitespace().collect::<Vec<_>>().join(" ");
    result = result.trim().to_string();

    result
}

fn strip_bracket_instructions(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let mut bracket_content = String::new();
            bracket_content.push(c);
            while let Some(&nc) = chars.peek() {
                match chars.next() {
                    Some(ch) => bracket_content.push(ch),
                    None => break,
                }
                if nc == ']' { break; }
            }
            let lower = bracket_content.to_lowercase();
            let is_instruction = lower.contains("系统指令")
                || lower.contains("系统提示")
                || lower.contains("system:")
                || lower.contains("system ")
                || lower.contains("system_")
                || lower.contains("instruction:")
                || lower.contains("instruction ")
                || lower.contains("important:")
                || lower.contains("critical:")
                || lower.contains("warning:")
                || lower.contains("note:")
                || lower.contains("提示词")
                || lower.contains("system prompt")
                || lower.contains("internal")
                || lower.contains("internal_")
                || lower.starts_with("[指令")
                || lower.starts_with("[系统")
                || lower.starts_with("[提示");
            if !is_instruction {
                result.push_str(&bracket_content);
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn strip_absolute_paths(text: &str) -> String {
    let unix_prefixes = [
        "/tmp/", "/home/", "/var/", "/usr/", "/etc/", "/company/",
        "/users/", "/opt/", "/srv/", "/mnt/", "/dev/", "/proc/",
        "/sys/", "/root/",
    ];
    let mut result = text.to_string();

    loop {
        if let Some(start) = result.find("~/") {
            let path_end = result[start..].find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ']')
                .map(|i| start + i)
                .unwrap_or(result.len());
            let full_path = &result[start..path_end];
            let file_name = full_path.rsplit('/').next().unwrap_or(full_path).to_string();
            result.replace_range(start..path_end, &file_name);
        } else {
            break;
        }
    }

    for prefix in &unix_prefixes {
        loop {
            let replacement = {
                if let Some(start) = result.find(prefix) {
                    let path_end = result[start..].find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ']')
                        .map(|i| start + i)
                        .unwrap_or(result.len());
                    let full_path = &result[start..path_end];
                    let file_name = full_path.rsplit('/').next().unwrap_or(full_path).to_string();
                    Some((start..path_end, file_name))
                } else {
                    None
                }
            };
            if let Some((range, file_name)) = replacement {
                result.replace_range(range, &file_name);
            } else {
                break;
            }
        }
    }

    let win_replacement = {
        if let Some(start) = result.find(|c: char| c.is_ascii_uppercase()) {
            if start + 2 < result.len() {
                let slice = &result[start..start+2];
                let mut slice_chars = slice.chars();
                if let (Some(first), Some(second)) = (slice_chars.next(), slice_chars.next()) {
                    if first.is_ascii_uppercase() && second == ':' {
                        let path_end = result[start..].find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                            .map(|i| start + i)
                            .unwrap_or(result.len());
                        let full_path = &result[start..path_end];
                        let file_name = full_path.rsplit(|c| c == '\\' || c == '/').next().unwrap_or(full_path).to_string();
                        Some((start..path_end, file_name))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some((range, file_name)) = win_replacement {
        result.replace_range(range, &file_name);
    }

    result
}

fn strip_markdown_system_headers(text: &str) -> String {
    let system_keywords = [
        "system", "instruction", "important", "critical", "warning",
        "note:", "提示词", "系统指令", "系统提示", "internal",
        "must call", "must use", "you must", "you are",
    ];

    let lines: Vec<&str> = text.lines().collect();
    let mut result_lines: Vec<String> = Vec::new();

    for line in &lines {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        let is_heading = trimmed.starts_with('#');
        let is_bold_instruction = trimmed.starts_with("**") && trimmed.ends_with("**");

        let contains_system_kw = system_keywords.iter().any(|kw| lower.contains(kw));

        if (is_heading || is_bold_instruction) && contains_system_kw {
            continue;
        }

        let mut cleaned = line.to_string();
        if !is_heading && contains_system_kw {
            let mut pos: usize = 0;
            while let Some(start) = cleaned[pos..].find("**") {
                let abs_start = pos + start;
                if let Some(end) = cleaned[abs_start + 2..].find("**") {
                    let abs_end = abs_start + 2 + end;
                    let bold_segment = &cleaned[abs_start + 2..abs_end];
                    let bold_lower = bold_segment.to_lowercase();
                    if system_keywords.iter().any(|kw| bold_lower.contains(kw)) {
                        cleaned.replace_range(abs_start..abs_end + 2, "");
                    } else {
                        pos = abs_end + 2;
                    }
                } else {
                    break;
                }
            }
        }

        if !cleaned.trim().is_empty() {
            result_lines.push(cleaned);
        }
    }

    result_lines.join(" ")
}
