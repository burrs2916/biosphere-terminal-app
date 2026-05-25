use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    Auto,
    Confirm,
}

impl Default for PermissionMode {
    fn default() -> Self {
        PermissionMode::Confirm
    }
}

impl std::fmt::Display for PermissionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionMode::Auto => write!(f, "auto"),
            PermissionMode::Confirm => write!(f, "confirm"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolRiskLevel {
    Low,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub conversation_id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub risk_level: ToolRiskLevel,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub conversation_id: String,
    pub approved: bool,
    pub always_allow: bool,
}

fn high_risk_tools() -> &'static [&'static str] {
    &["terminal", "terminal_session"]
}

fn high_risk_file_actions() -> &'static [&'static str] {
    &["write", "delete", "create"]
}

fn builtin_tools() -> &'static [&'static str] {
    &["terminal", "terminal_session", "file", "notebook", "memory", "command_history", "plugin_manager"]
}

pub fn classify_tool_risk(tool_name: &str, arguments: &serde_json::Value) -> ToolRiskLevel {
    if high_risk_tools().contains(&tool_name) {
        return ToolRiskLevel::High;
    }

    if tool_name == "file" {
        if let Some(action) = arguments["action"].as_str() {
            if high_risk_file_actions().contains(&action) {
                return ToolRiskLevel::High;
            }
        }
    }

    if tool_name == "plugin_manager" {
        if let Some(action) = arguments["action"].as_str() {
            if matches!(action, "create" | "update" | "delete" | "toggle") {
                return ToolRiskLevel::High;
            }
        }
    }

    if !builtin_tools().contains(&tool_name) {
        return ToolRiskLevel::High;
    }

    ToolRiskLevel::Low
}

pub fn should_confirm(
    mode: PermissionMode,
    tool_name: &str,
    arguments: &serde_json::Value,
    always_allowed: &[String],
) -> bool {
    if mode == PermissionMode::Auto {
        return false;
    }

    if always_allowed.contains(&tool_name.to_string()) {
        return false;
    }

    matches!(classify_tool_risk(tool_name, arguments), ToolRiskLevel::High)
}

pub fn build_permission_description(tool_name: &str, arguments: &serde_json::Value) -> String {
    match tool_name {
        "terminal" | "terminal_session" => {
            let cmd = arguments["command"].as_str().unwrap_or("<command>");
            format!("Execute command: {}", cmd)
        }
        "file" => {
            let action = arguments["action"].as_str().unwrap_or("unknown");
            let path = arguments["path"].as_str().unwrap_or("<path>");
            format!("File {} : {}", action, path)
        }
        "plugin_manager" => {
            let action = arguments["action"].as_str().unwrap_or("unknown");
            match action {
                "create" => {
                    let name = arguments["name"].as_str().unwrap_or("unknown");
                    let tools_desc = if let Some(tools) = arguments["tools"].as_array() {
                        tools.iter().filter_map(|t| {
                            let tname = t["name"].as_str().unwrap_or("?");
                            let script = t["script"].as_str().unwrap_or("");
                            if script.is_empty() {
                                Some(format!("  • {}: (no script)", tname))
                            } else {
                                Some(format!("  • {}: {}", tname, script))
                            }
                        }).collect::<Vec<_>>().join("\n")
                    } else {
                        "(no tools specified)".to_string()
                    };
                    format!("Create plugin '{}'\nTools:\n{}", name, tools_desc)
                }
                "update" => {
                    let plugin_id = arguments["plugin_id"].as_str().unwrap_or("unknown");
                    let tools_desc = if let Some(tools) = arguments["tools"].as_array() {
                        tools.iter().filter_map(|t| {
                            let tname = t["name"].as_str().unwrap_or("?");
                            let script = t["script"].as_str().unwrap_or("");
                            if script.is_empty() {
                                Some(format!("  • {}: (no script)", tname))
                            } else {
                                Some(format!("  • {}: {}", tname, script))
                            }
                        }).collect::<Vec<_>>().join("\n")
                    } else {
                        String::new()
                    };
                    if tools_desc.is_empty() {
                        format!("Update plugin '{}'", plugin_id)
                    } else {
                        format!("Update plugin '{}' with tools:\n{}", plugin_id, tools_desc)
                    }
                }
                "delete" => {
                    let plugin_id = arguments["plugin_id"].as_str().unwrap_or("unknown");
                    format!("Delete plugin '{}'", plugin_id)
                }
                "toggle" => {
                    let plugin_id = arguments["plugin_id"].as_str().unwrap_or("unknown");
                    let enabled = arguments["enabled"].as_bool().unwrap_or(false);
                    format!("{} plugin '{}'", if enabled { "Enable" } else { "Disable" }, plugin_id)
                }
                _ => format!("Plugin manager: {}", action)
            }
        }
        _ => {
            let args_str = if let Some(obj) = arguments.as_object().filter(|o| !o.is_empty()) {
                obj.iter()
                    .map(|(k, v)| format!("  {}: {}", k, v))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                "(no parameters)".to_string()
            };
            format!("Plugin tool: {}\nParameters:\n{}", tool_name, args_str)
        }
    }
}
