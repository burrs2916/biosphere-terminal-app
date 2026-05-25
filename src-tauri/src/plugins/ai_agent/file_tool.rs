use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

use super::engine::{AgentTool, ToolOutput};

pub struct FileTool {
    workspace_dir: PathBuf,
}

impl FileTool {
    pub fn new(workspace_dir: PathBuf) -> Self {
        let dir = workspace_dir.join("output");
        let _ = std::fs::create_dir_all(&dir);
        FileTool { workspace_dir: dir }
    }
}

pub fn get_default_workspace_dir(agent_id: &str) -> PathBuf {
    let base = dirs_next::document_dir()
        .or_else(dirs_next::data_dir)
        .or_else(dirs_next::home_dir)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("BiosphereTerminal").join("agents").join(agent_id)
}

pub fn resolve_workspace_dir(agent_workspace: &str, agent_id: &str) -> PathBuf {
    if !agent_workspace.is_empty() {
        let p = PathBuf::from(agent_workspace);
        if p.is_absolute() {
            return p;
        }
    }
    get_default_workspace_dir(agent_id)
}

fn get_file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

async fn convert_pdf_to_text(path: &Path) -> Result<String, String> {
    let output = tokio::process::Command::new("pdftotext")
        .arg("-layout")
        .arg(path)
        .arg("-")
        .output()
        .await
        .map_err(|e| format!("Failed to run pdftotext: {}. Is poppler-utils installed?", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pdftotext failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn convert_docx_to_text(path: &Path) -> Result<String, String> {
    let output = tokio::process::Command::new("python3")
        .args([
            "-c",
            "import sys, zipfile, xml.etree.ElementTree as ET; \
             z = zipfile.ZipFile(sys.argv[1]); \
             doc = z.read('word/document.xml'); \
             root = ET.fromstring(doc); \
             ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}; \
             texts = [t.text for t in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if t.text]; \
             print('\\n'.join(texts))",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run python3 for docx: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python3 docx extraction failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn convert_xlsx_to_text(path: &Path) -> Result<String, String> {
    let output = tokio::process::Command::new("python3")
        .args([
            "-c",
            "import sys, zipfile, xml.etree.ElementTree as ET; \
             z = zipfile.ZipFile(sys.argv[1]); \
             sheets = [n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]; \
             ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}; \
             for s in sorted(sheets): \
                 root = ET.fromstring(z.read(s)); \
                 for row in root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'): \
                     cells = [c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v') for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c')]; \
                     vals = [v.text if v is not None and v.text else '' for v in cells]; \
                     print('\\t'.join(vals))",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run python3 for xlsx: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python3 xlsx extraction failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn convert_csv_to_text(path: &Path, max_lines: usize) -> Result<String, String> {
    let content = tokio::fs::read_to_string(path).await
        .map_err(|e| format!("Failed to read CSV: {}", e))?;
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let display = if lines.len() > max_lines {
        lines[..max_lines].join("\n")
    } else {
        content.clone()
    };
    if total > max_lines {
        Ok(format!("(showing first {} of {} lines)\n{}", max_lines, total, display))
    } else {
        Ok(display)
    }
}

async fn convert_image_metadata(path: &Path) -> Result<String, String> {
    let output = tokio::process::Command::new("file")
        .arg(path)
        .output()
        .await
        .map_err(|e| format!("Failed to run 'file' command: {}", e))?;

    let file_info = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let size_info = std::fs::metadata(path)
        .map(|m| format!("Size: {} bytes", m.len()))
        .unwrap_or_default();

    Ok(format!("{}\n{}\n\nNote: Image files cannot be converted to text. Consider using a vision-capable AI model for image analysis.", file_info, size_info))
}

#[async_trait]
impl AgentTool for FileTool {
    fn name(&self) -> &str {
        "file"
    }

    fn description(&self) -> &str {
        "Read, write, list, analyze files on the local filesystem. Supports text files and can extract text from PDF, DOCX, XLSX, CSV documents. Use 'read' for text files, 'analyze' for documents (PDF/DOCX/XLSX/CSV), 'write' to create files, 'list' for directories, 'exists' to check paths. Relative paths are resolved against the agent workspace directory. When a user provides a file attachment path (e.g. [附件: /path/to/file]), use this tool to read or analyze the file content before responding."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "write", "list", "exists", "analyze"],
                    "description": "The action to perform: 'read' to read text file content, 'write' to write content to a file, 'analyze' to extract text from documents (PDF/DOCX/XLSX/CSV), 'list' to list directory contents, 'exists' to check if a path exists"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory path. Relative paths are resolved against the agent workspace directory."
                },
                "content": {
                    "type": "string",
                    "description": "Content to write (required for 'write' action)"
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

        let path = if Path::new(path_str).is_absolute() {
            PathBuf::from(path_str)
        } else {
            self.workspace_dir.join(path_str)
        };

        let home_dir = dirs_next::home_dir().unwrap_or_default();
        let is_allowed = path.starts_with(&home_dir)
            || path.starts_with("/tmp")
            || path.starts_with("/var/log")
            || path.starts_with(&self.workspace_dir);

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

                let metadata = std::fs::metadata(&path)
                    .map_err(|e| format!("Failed to read file metadata: {}", e))?;

                if metadata.len() > 5 * 1024 * 1024 {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("File too large ({} bytes). Maximum size is 5MB.", metadata.len()),
                        metadata: Value::Null,
                    });
                }

                let content = tokio::fs::read_to_string(&path).await
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

                let mut entries = tokio::fs::read_dir(&path).await
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
            "analyze" => {
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

                let metadata = std::fs::metadata(&path)
                    .map_err(|e| format!("Failed to read file metadata: {}", e))?;

                if metadata.len() > 20 * 1024 * 1024 {
                    return Ok(ToolOutput {
                        success: false,
                        result: format!("File too large ({} bytes). Maximum size for analysis is 20MB.", metadata.len()),
                        metadata: Value::Null,
                    });
                }

                let max_lines = params["max_lines"].as_i64()
                    .unwrap_or(500)
                    .min(1000)
                    .max(1) as usize;

                let ext = get_file_extension(&path);
                let file_size = metadata.len();

                let (content, file_type) = match ext.as_str() {
                    "pdf" => {
                        match convert_pdf_to_text(&path).await {
                            Ok(text) => (text, "PDF"),
                            Err(e) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!("Failed to extract text from PDF '{}': {}. Install pdftotext (poppler-utils) for PDF support.", path_str, e),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                    "docx" | "doc" => {
                        match convert_docx_to_text(&path).await {
                            Ok(text) => (text, "DOCX"),
                            Err(e) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!("Failed to extract text from DOCX '{}': {}. Python3 is required for DOCX support.", path_str, e),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                    "xlsx" | "xls" => {
                        match convert_xlsx_to_text(&path).await {
                            Ok(text) => (text, "XLSX"),
                            Err(e) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!("Failed to extract text from XLSX '{}': {}. Python3 is required for XLSX support.", path_str, e),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                    "csv" | "tsv" => {
                        match convert_csv_to_text(&path, max_lines).await {
                            Ok(text) => (text, "CSV"),
                            Err(e) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!("Failed to read CSV '{}': {}", path_str, e),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                    "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg" | "tiff" | "ico" => {
                        match convert_image_metadata(&path).await {
                            Ok(text) => (text, "IMAGE"),
                            Err(e) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!("Failed to get image info '{}': {}", path_str, e),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                    _ => {
                        match tokio::fs::read_to_string(&path).await {
                            Ok(text) => (text, "TEXT"),
                            Err(_) => {
                                return Ok(ToolOutput {
                                    success: false,
                                    result: format!(
                                        "Cannot analyze file '{}' with extension '{}'. Supported formats: PDF, DOCX, XLSX, CSV, and text files.",
                                        path_str, ext
                                    ),
                                    metadata: json!({ "path": path_str, "extension": ext, "size": file_size }),
                                });
                            }
                        }
                    }
                };

                let lines: Vec<&str> = content.lines().collect();
                let total_lines = lines.len();
                let truncated = total_lines > max_lines;

                let display_content = if truncated {
                    lines[..max_lines].join("\n")
                } else {
                    content.clone()
                };

                Ok(ToolOutput {
                    success: true,
                    result: if truncated {
                        format!("File analysis: {} (type: {}, size: {} bytes, showing first {} of {} lines)\n{}", path_str, file_type, file_size, max_lines, total_lines, display_content)
                    } else {
                        format!("File analysis: {} (type: {}, size: {} bytes, {} lines)\n{}", path_str, file_type, file_size, total_lines, display_content)
                    },
                    metadata: json!({
                        "path": path_str,
                        "fileType": file_type,
                        "extension": ext,
                        "size": file_size,
                        "lines": total_lines,
                        "truncated": truncated,
                    }),
                })
            }
            "write" => {
                let content = params["content"].as_str()
                    .ok_or_else(|| "Missing 'content' parameter for write action".to_string())?;

                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                tokio::fs::write(&path, content).await
                    .map_err(|e| format!("Failed to write file: {}", e))?;

                let written_bytes = content.len();
                Ok(ToolOutput {
                    success: true,
                    result: format!("Successfully wrote {} bytes to {}", written_bytes, path.display()),
                    metadata: json!({
                        "path": path.display().to_string(),
                        "size": written_bytes,
                    }),
                })
            }
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Use 'read', 'write', 'list', 'exists', or 'analyze'.", action),
                metadata: Value::Null,
            }),
        }
    }
}
