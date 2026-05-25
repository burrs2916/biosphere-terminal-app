use async_trait::async_trait;
use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;

use super::engine::{AgentTool, ToolOutput};

pub struct MemoryTool {
    base_dir: PathBuf,
}

impl MemoryTool {
    pub fn new(base_dir: PathBuf) -> Self {
        let memory_dir = base_dir.join("memory");
        let _ = fs::create_dir_all(&memory_dir);
        MemoryTool { base_dir }
    }

    fn memory_file(&self) -> PathBuf {
        self.base_dir.join("MEMORY.md")
    }

    fn daily_file(&self) -> PathBuf {
        let now = chrono::Local::now();
        let filename = format!("{}.md", now.format("%Y-%m-%d"));
        self.base_dir.join("memory").join(filename)
    }

    pub fn load_memory_for_prompt(&self) -> String {
        let mut parts = Vec::new();

        if let Ok(content) = fs::read_to_string(self.memory_file()) {
            if !content.trim().is_empty() {
                parts.push(format!("[Long-term Memory]\n{}", content.trim()));
            }
        }

        let today = self.daily_file();
        if let Ok(content) = fs::read_to_string(&today) {
            if !content.trim().is_empty() {
                parts.push(format!("[Today's Notes]\n{}", content.trim()));
            }
        }

        let yesterday = {
            let now = chrono::Local::now() - chrono::Duration::days(1);
            let filename = format!("{}.md", now.format("%Y-%m-%d"));
            self.base_dir.join("memory").join(filename)
        };
        if let Ok(content) = fs::read_to_string(&yesterday) {
            if !content.trim().is_empty() {
                parts.push(format!("[Yesterday's Notes]\n{}", content.trim()));
            }
        }

        if parts.is_empty() {
            String::new()
        } else {
            format!("\n\n--- Agent Memory ---\n{}\n--- End Memory ---", parts.join("\n\n"))
        }
    }
}

#[async_trait]
impl AgentTool for MemoryTool {
    fn name(&self) -> &str {
        "memory"
    }

    fn description(&self) -> &str {
        "Save and retrieve persistent memory across conversations. Use 'save' to store important facts, preferences, or decisions. Use 'read' to recall stored memory. Use 'search' to find relevant notes by keyword. Memory persists between sessions."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["save", "read", "search", "list"],
                    "description": "Action: 'save' to write to memory, 'read' to read a specific file, 'search' to search by keyword, 'list' to list memory files"
                },
                "content": {
                    "type": "string",
                    "description": "Content to save (for 'save' action). Will be appended to the appropriate memory file."
                },
                "target": {
                    "type": "string",
                    "enum": ["long_term", "daily"],
                    "description": "Where to save: 'long_term' for durable facts/preferences (MEMORY.md), 'daily' for today's running notes (default: 'daily')"
                },
                "query": {
                    "type": "string",
                    "description": "Search query for 'search' action, or file date for 'read' action (YYYY-MM-DD format)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "save" => {
                let content = params["content"].as_str()
                    .ok_or_else(|| "Missing 'content' parameter for save".to_string())?;
                let target = params["target"].as_str().unwrap_or("daily");

                let file_path = match target {
                    "long_term" => self.memory_file(),
                    _ => self.daily_file(),
                };

                if !file_path.exists() {
                    let header = match target {
                        "long_term" => "# Long-term Memory\n\nFacts, preferences, and decisions that persist across all sessions.\n\n",
                        _ => &format!("# Daily Notes - {}\n\n", chrono::Local::now().format("%Y-%m-%d")),
                    };
                    fs::write(&file_path, header).map_err(|e| format!("Failed to create memory file: {}", e))?;
                }

                let existing = fs::read_to_string(&file_path).unwrap_or_default();
                let timestamp = chrono::Local::now().format("%H:%M");
                let entry = format!("\n## [{}]\n{}\n", timestamp, content);
                fs::write(&file_path, format!("{}{}", existing, entry))
                    .map_err(|e| format!("Failed to write memory: {}", e))?;

                Ok(ToolOutput {
                    success: true,
                    result: format!("Saved to {} memory", match target { "long_term" => "long-term", _ => "daily" }),
                    metadata: json!({"target": target, "file": file_path.to_string_lossy()}),
                })
            }
            "read" => {
                let query = params["query"].as_str().unwrap_or("");
                let file_path = if query.is_empty() || query == "long_term" {
                    self.memory_file()
                } else {
                    self.base_dir.join("memory").join(format!("{}.md", query))
                };

                if !file_path.exists() {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("Memory file not found: {}", file_path.display()),
                        metadata: Value::Null,
                    });
                }

                let content = fs::read_to_string(&file_path)
                    .map_err(|e| format!("Failed to read memory: {}", e))?;

                Ok(ToolOutput {
                    success: true,
                    result: content,
                    metadata: json!({"file": file_path.to_string_lossy()}),
                })
            }
            "search" => {
                let query = params["query"].as_str()
                    .ok_or_else(|| "Missing 'query' parameter for search".to_string())?;
                let query_lower = query.to_lowercase();

                let mut results = Vec::new();

                if let Ok(content) = fs::read_to_string(self.memory_file()) {
                    for line in content.lines() {
                        if line.to_lowercase().contains(&query_lower) {
                            results.push(format!("[MEMORY.md] {}", line));
                        }
                    }
                }

                let memory_dir = self.base_dir.join("memory");
                if memory_dir.exists() {
                    if let Ok(entries) = fs::read_dir(&memory_dir) {
                        for entry in entries.flatten() {
                            if let Ok(content) = fs::read_to_string(entry.path()) {
                                let filename = entry.file_name().to_string_lossy().to_string();
                                for line in content.lines() {
                                    if line.to_lowercase().contains(&query_lower) {
                                        results.push(format!("[{}] {}", filename, line));
                                    }
                                }
                            }
                        }
                    }
                }

                if results.is_empty() {
                    Ok(ToolOutput {
                        success: true,
                        result: format!("No results found for '{}'", query),
                        metadata: json!({"query": query, "count": 0}),
                    })
                } else {
                    Ok(ToolOutput {
                        success: true,
                        result: format!("Found {} results:\n{}", results.len(), results.join("\n")),
                        metadata: json!({"query": query, "count": results.len()}),
                    })
                }
            }
            "list" => {
                let mut files = Vec::new();

                if self.memory_file().exists() {
                    files.push("MEMORY.md (long-term)".to_string());
                }

                let memory_dir = self.base_dir.join("memory");
                if memory_dir.exists() {
                    if let Ok(entries) = fs::read_dir(&memory_dir) {
                        let mut daily: Vec<String> = entries
                            .flatten()
                            .filter(|e| e.path().extension().map(|ext| ext == "md").unwrap_or(false))
                            .map(|e| e.file_name().to_string_lossy().to_string())
                            .collect();
                        daily.sort();
                        daily.reverse();
                        for d in daily {
                            files.push(format!("memory/{}", d));
                        }
                    }
                }

                Ok(ToolOutput {
                    success: true,
                    result: if files.is_empty() { "No memory files yet".to_string() } else { files.join("\n") },
                    metadata: json!({"count": files.len()}),
                })
            }
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action: {}", action),
                metadata: Value::Null,
            }),
        }
    }
}
