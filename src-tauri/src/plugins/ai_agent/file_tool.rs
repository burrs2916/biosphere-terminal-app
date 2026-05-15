use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::Path;

use super::engine::{AgentTool, ToolOutput};

pub struct FileTool;

impl FileTool {
    pub fn new() -> Self {
        FileTool
    }
}

#[async_trait]
impl AgentTool for FileTool {
    fn name(&self) -> &str {
        "file"
    }

    fn description(&self) -> &str {
        "Read and list files on the local filesystem. Use this to inspect file contents, list directory contents, or check if files exist."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "list", "exists"],
                    "description": "The action to perform: 'read' to read file content, 'list' to list directory contents, 'exists' to check if a path exists"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory path (required)"
                },
                "encoding": {
                    "type": "string",
                    "enum": ["utf-8", "binary"],
                    "description": "File encoding (default: utf-8)"
                },
                "max_lines": {
                    "type": "number",
                    "description": "Maximum lines to read (default: 200, max: 1000)"
                }
            },
            "required": ["action", "path"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        let path_str = params["path"].as_str()
            .ok_or_else(|| "Missing 'path' parameter".to_string())?;

        let path = Path::new(path_str);

        if !path.is_absolute() {
            return Ok(ToolOutput {
                success: false,
                result: "Only absolute paths are allowed".to_string(),
                metadata: Value::Null,
            });
        }

        let home_dir = dirs_next::home_dir().unwrap_or_default();
        let is_allowed = path.starts_with(&home_dir)
            || path.starts_with("/tmp")
            || path.starts_with("/var/log");

        if !is_allowed {
            return Ok(ToolOutput {
                success: false,
                result: format!("Access denied: path '{}' is outside allowed directories", path_str),
                metadata: Value::Null,
            });
        }

        match action {
            "read" => {
                if !path.exists() {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("File not found: {}", path_str),
                        metadata: Value::Null,
                    });
                }
                if !path.is_file() {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("Path is not a file: {}", path_str),
                        metadata: Value::Null,
                    });
                }

                let max_lines = params["max_lines"].as_i64()
                    .unwrap_or(200)
                    .min(1000)
                    .max(1) as usize;

                let metadata = std::fs::metadata(path)
                    .map_err(|e| format!("Failed to read file metadata: {}", e))?;

                if metadata.len() > 5 * 1024 * 1024 {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("File too large ({} bytes). Maximum size is 5MB.", metadata.len()),
                        metadata: Value::Null,
                    });
                }

                let content = tokio::fs::read_to_string(path).await
                    .map_err(|e| format!("Failed to read file: {}", e))?;

                let lines: Vec<&str> = content.lines().collect();
                let total_lines = lines.len();
                let truncated = total_lines > max_lines;

                let display_content: String = if truncated {
                    lines[..max_lines].join("\n")
                } else {
                    content.clone()
                };

                Ok(ToolOutput {
                    success: true,
                    result: if truncated {
                        format!("{} (showing first {} of {} lines)\n{}", path_str, max_lines, total_lines, display_content)
                    } else {
                        display_content
                    },
                    metadata: json!({
                        "path": path_str,
                        "size": metadata.len(),
                        "lines": total_lines,
                        "truncated": truncated,
                    }),
                })
            }
            "list" => {
                if !path.exists() {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("Directory not found: {}", path_str),
                        metadata: Value::Null,
                    });
                }
                if !path.is_dir() {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("Path is not a directory: {}", path_str),
                        metadata: Value::Null,
                    });
                }

                let mut entries = tokio::fs::read_dir(path).await
                    .map_err(|e| format!("Failed to read directory: {}", e))?;

                let mut items = Vec::new();
                while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Error reading entry: {}", e))? {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        continue;
                    }
                    let file_type = entry.file_type().await.map_err(|e| format!("Error getting file type: {}", e))?;
                    let item_type = if file_type.is_dir() { "dir" } else { "file" };
                    let size = if file_type.is_file() {
                        entry.metadata().await.map(|m| m.len()).unwrap_or(0)
                    } else {
                        0
                    };
                    items.push(json!({
                        "name": name,
                        "type": item_type,
                        "size": size,
                    }));
                }

                items.sort_by(|a, b| {
                    let a_is_dir = a["type"].as_str() == Some("dir");
                    let b_is_dir = b["type"].as_str() == Some("dir");
                    match (a_is_dir, b_is_dir) {
                        (true, false) => std::cmp::Ordering::Less,
                        (false, true) => std::cmp::Ordering::Greater,
                        _ => a["name"].as_str().cmp(&b["name"].as_str()),
                    }
                });

                let display = items.iter().map(|item| {
                    let prefix = if item["type"].as_str() == Some("dir") { "📁 " } else { "📄 " };
                    let size_str = if item["size"].as_u64().unwrap_or(0) > 0 {
                        format!(" ({} bytes)", item["size"].as_u64().unwrap_or(0))
                    } else {
                        String::new()
                    };
                    format!("{}{}{}", prefix, item["name"].as_str().unwrap_or("?"), size_str)
                }).collect::<Vec<_>>().join("\n");

                Ok(ToolOutput {
                    success: true,
                    result: format!("Contents of {} ({} items):\n{}", path_str, items.len(), display),
                    metadata: json!({ "items": items, "total": items.len() }),
                })
            }
            "exists" => {
                let exists = path.exists();
                let is_file = path.is_file();
                let is_dir = path.is_dir();

                Ok(ToolOutput {
                    success: true,
                    result: if exists {
                        format!("Path '{}' exists ({})", path_str, if is_file { "file" } else if is_dir { "directory" } else { "other" })
                    } else {
                        format!("Path '{}' does not exist", path_str)
                    },
                    metadata: json!({
                        "path": path_str,
                        "exists": exists,
                        "isFile": is_file,
                        "isDir": is_dir,
                    }),
                })
            }
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Use 'read', 'list', or 'exists'.", action),
                metadata: Value::Null,
            }),
        }
    }
}
