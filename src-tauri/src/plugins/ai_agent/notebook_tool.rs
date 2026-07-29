use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

use crate::app::notebook_service::NotebookService;
use crate::infra::storage::database::Database;
use crate::infra::storage::note_repo::{NoteRepo, NoteGroupRepo, NoteRow};
use super::engine::{AgentTool, ToolOutput};

/// 读取笔记正文：优先从 .md 文件读取；文件缺失或读取失败时回退到 DB 的 `content` 冗余列
/// （与 `NotebookService::get_note` 的兜底策略一致，P0-3）。
/// 切勿在文件缺失时回退成空串——否则 retag/move/update 会把笔记正文静默清空（数据丢失）。
fn read_note_content_or_fallback(existing: &NoteRow) -> String {
    let file_path = std::path::PathBuf::from(&existing.file_path);
    if file_path.exists() {
        crate::infra::filesystem::note_fs::NoteFileSystem::new(
            file_path.parent().unwrap_or(std::path::Path::new("."))
        )
        .read_note(&file_path)
        .map(|(_, body)| body)
        .unwrap_or_else(|_| existing.content.clone())
    } else {
        existing.content.clone()
    }
}

/// 防御性清理：若 AI 返回的 `content` 误带了 YAML front matter（形如 `---\n...\n---`），
/// 剥掉它、只保留其后正文，避免把 front matter 当笔记正文嵌套写入、污染笔记内容
/// （AI 辅助整理路径下的真实数据损坏风险：工具描述虽要求只返回 body，模型偶尔会连 front matter 一起返回）。
/// 仅当块看起来像 YAML 映射（含 `key:`）时才剥离，降低误删正文里 markdown 分隔线的概率。
fn strip_leading_front_matter(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---\n") {
        return content.to_string();
    }
    if let Some(close) = trimmed.find("\n---") {
        let fm_block = &trimmed[4..close]; // 跳过开头的 "---\n"
        if fm_block.contains(':') {
            let after = &trimmed[close + 4..];
            return after.trim_start_matches('\n').to_string();
        }
    }
    content.to_string()
}

pub struct NotebookTool {
    db: Arc<Database>,
    notebook: Option<Arc<NotebookService>>,
}

impl NotebookTool {
    #[allow(dead_code)]
    pub fn new(db: Arc<Database>) -> Self {
        NotebookTool { db, notebook: None }
    }

    pub fn with_notebook(db: Arc<Database>, notebook: Arc<NotebookService>) -> Self {
        NotebookTool { db, notebook: Some(notebook) }
    }

    fn get_notebook(&self) -> Result<&NotebookService, String> {
        self.notebook.as_ref()
            .map(|n| n.as_ref())
            .ok_or_else(|| "NotebookService not available".to_string())
    }
}

#[async_trait]
impl AgentTool for NotebookTool {
    fn name(&self) -> &str {
        "notebook"
    }

    fn description(&self) -> &str {
        "Manage notes in the notebook: search, read, create, update, delete, retag, move, and link commands to notes. Notes are stored as Markdown files with YAML front matter (--- delimited block containing id, title, category, tags, created_at, updated_at, linked_commands). When updating a note, the 'content' parameter should contain ONLY the Markdown body (after the front matter), never include the front matter block. If 'content' is not provided, the existing content is preserved."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["search", "read", "list", "create", "update", "delete", "retag", "move", "link_command", "list_groups", "list_categories"],
                    "description": "Action: 'search' find notes by keyword, 'read' get full content, 'list' list recent notes, 'create' create new note, 'update' update note content/title, 'delete' delete note, 'retag' change tags/category, 'move' move to another group, 'link_command' link a command to a note, 'list_groups' list all groups, 'list_categories' list categories in a group"
                },
                "query": {
                    "type": "string",
                    "description": "Search query (for 'search' action)"
                },
                "note_id": {
                    "type": "string",
                    "description": "Note ID (for 'read', 'update', 'delete', 'retag', 'move', 'link_command' actions)"
                },
                "title": {
                    "type": "string",
                    "description": "Note title (for 'create', 'update' actions)"
                },
                "content": {
                    "type": "string",
                    "description": "Note content in Markdown (for 'create', 'update' actions)"
                },
                "group_id": {
                    "type": "string",
                    "description": "Group ID (for 'create', 'move' actions)"
                },
                "category": {
                    "type": "string",
                    "description": "Category name (for 'create', 'retag' actions)"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tags array (for 'create', 'retag' actions)"
                },
                "command_id": {
                    "type": "string",
                    "description": "Command ID to link (for 'link_command' action)"
                },
                "command_text": {
                    "type": "string",
                    "description": "Command text for context when linking (for 'link_command' action)"
                },
                "limit": {
                    "type": "number",
                    "description": "Max results (default: 10, max: 50)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        let limit = params["limit"].as_i64()
            .unwrap_or(10)
            .min(50)
            .max(1) as usize;

        match action {
            "search" => self.action_search(&params, limit).await,
            "read" => self.action_read(&params).await,
            "list" => self.action_list(limit).await,
            "create" => self.action_create(&params).await,
            "update" => self.action_update(&params).await,
            "delete" => self.action_delete(&params).await,
            "retag" => self.action_retag(&params).await,
            "move" => self.action_move(&params).await,
            "link_command" => self.action_link_command(&params).await,
            "list_groups" => self.action_list_groups().await,
            "list_categories" => self.action_list_categories(&params).await,
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Available: search, read, list, create, update, delete, retag, move, link_command, list_groups, list_categories", action),
                metadata: Value::Null,
            }),
        }
    }
}

impl NotebookTool {
    async fn action_search(&self, params: &Value, limit: usize) -> Result<ToolOutput, String> {
        let query = params["query"].as_str()
            .ok_or_else(|| "Missing 'query' parameter for search".to_string())?;

        let notes = NoteRepo::list(&self.db, None, None, Some(query))
            .map_err(|e| e.to_string())?;

        let results: Vec<Value> = notes.iter().take(limit).map(|n| json!({
            "id": n.id,
            "title": n.title,
            "groupId": n.group_id,
            "category": n.category,
            "tags": n.tags,
            "updatedAt": n.updated_at,
        })).collect();

        Ok(ToolOutput {
            success: true,
            result: if results.is_empty() {
                format!("No notes found matching '{}'", query)
            } else {
                format!("Found {} note(s):\n{}", results.len(),
                    results.iter().map(|r| format!("- [{}] {} (group: {}, tags: {})", r["id"], r["title"], r["groupId"], r["tags"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": results }),
        })
    }

    async fn action_read(&self, params: &Value) -> Result<ToolOutput, String> {
        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for read".to_string())?;

        let note = NoteRepo::get_by_id(&self.db, note_id)
            .map_err(|e| e.to_string())?;

        match note {
            Some(n) => {
                let content = read_note_content_or_fallback(&n);

                let linked_commands = self.get_notebook()
                    .ok()
                    .map(|nb| nb.get_linked_commands(note_id))
                    .transpose()
                    .ok()
                    .flatten()
                    .unwrap_or_default();

                let linked_cmds_str = if linked_commands.is_empty() {
                    String::new()
                } else {
                    format!("\n\nLinked commands: {}", linked_commands.iter()
                        .map(|l| format!("{} (context: {})", l.command_id, l.context))
                        .collect::<Vec<_>>().join(", "))
                };

                Ok(ToolOutput {
                    success: true,
                    result: format!("# {}\nGroup: {} | Category: {} | Tags: {}\n\n{}{}", n.title, n.group_id, n.category, n.tags.join(", "), content, linked_cmds_str),
                    metadata: json!({
                        "id": n.id,
                        "title": n.title,
                        "groupId": n.group_id,
                        "category": n.category,
                        "tags": n.tags,
                        "wordCount": n.word_count,
                    }),
                })
            }
            None => Ok(ToolOutput {
                success: false,
                result: format!("Note '{}' not found", note_id),
                metadata: Value::Null,
            }),
        }
    }

    async fn action_list(&self, limit: usize) -> Result<ToolOutput, String> {
        let notes = NoteRepo::list(&self.db, None, None, None)
            .map_err(|e| e.to_string())?;

        let mut sorted_notes = notes;
        sorted_notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        let results: Vec<Value> = sorted_notes.iter().take(limit).map(|n| json!({
            "id": n.id,
            "title": n.title,
            "groupId": n.group_id,
            "category": n.category,
            "tags": n.tags,
            "updatedAt": n.updated_at,
        })).collect();

        Ok(ToolOutput {
            success: true,
            result: if results.is_empty() {
                "No notes found".to_string()
            } else {
                format!("Recent notes ({}):\n{}", results.len(),
                    results.iter().map(|r| format!("- [{}] {} (group: {}, tags: {})", r["id"], r["title"], r["groupId"], r["tags"])).collect::<Vec<_>>().join("\n"))
            },
            metadata: json!({ "results": results }),
        })
    }

    async fn action_create(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let title = params["title"].as_str()
            .ok_or_else(|| "Missing 'title' parameter for create".to_string())?;
        let content = params["content"].as_str().unwrap_or("");
        // 归一化分组：空值或缺省用兜底组 "uncategorized"（必定存在）；
        // 显式指定了一个不存在的分组时，也回退到兜底组，避免 notes.group_id 外键失败导致创建失败。
        let group_id = match params["group_id"].as_str() {
            Some(g) if !g.is_empty() => {
                if NoteGroupRepo::get_by_id(&self.db, g)
                    .map(|opt| opt.is_some())
                    .unwrap_or(false)
                {
                    g.to_string()
                } else {
                    "uncategorized".to_string()
                }
            }
            _ => "uncategorized".to_string(),
        };
        let category = params["category"].as_str().unwrap_or("");
        let tags: Vec<String> = params["tags"].as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        let note = notebook.create_note(title, content, &group_id, category, tags)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Created note '{}' (id: {}, group: {}, category: {})", note.title, note.id, note.group_id, note.category),
            metadata: json!({
                "id": note.id,
                "title": note.title,
                "groupId": note.group_id,
                "category": note.category,
                "tags": note.tags,
            }),
        })
    }

    async fn action_update(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for update".to_string())?;

        let existing = NoteRepo::get_by_id(&self.db, note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Note not found".to_string())?;

        // 文件缺失时回退到 DB 冗余列，避免把正文静默清空（P0-3/数据丢失）
        let existing_content = read_note_content_or_fallback(&existing);

        let title = params["title"].as_str().unwrap_or(&existing.title);
        let content_raw = params["content"].as_str().unwrap_or("");
        // 防御：剥离模型可能误带的 front matter，避免污染笔记正文（见 strip_leading_front_matter）
        let cleaned = strip_leading_front_matter(content_raw);
        let content = if cleaned.is_empty() { existing_content.as_str() } else { cleaned.as_str() };
        let group_id = params["group_id"].as_str().unwrap_or(&existing.group_id);
        let category = params["category"].as_str().unwrap_or(&existing.category);
        let tags: Vec<String> = if params["tags"].is_array() {
            params["tags"].as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or(existing.tags.clone())
        } else {
            existing.tags.clone()
        };

        let note = notebook.update_note(note_id, title, content, group_id, category, tags)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Updated note '{}' (id: {})", note.title, note.id),
            metadata: json!({
                "id": note.id,
                "title": note.title,
                "groupId": note.group_id,
                "category": note.category,
                "tags": note.tags,
            }),
        })
    }

    async fn action_delete(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for delete".to_string())?;

        let existing = NoteRepo::get_by_id(&self.db, note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Note not found".to_string())?;

        notebook.delete_note(note_id)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Deleted note '{}' (id: {})", existing.title, note_id),
            metadata: json!({ "id": note_id }),
        })
    }

    async fn action_retag(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for retag".to_string())?;

        let existing = NoteRepo::get_by_id(&self.db, note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Note not found".to_string())?;

        // 文件缺失时回退到 DB 冗余列，避免把正文静默清空（P0-3/数据丢失）。
        // 注意：此处正文来自 read_note，front matter 已被解析阶段剥离，绝不会包含 front matter；
        // 因此【不能】再跑 strip_leading_front_matter——否则当正文本身以 "---...---" 块开头
        // （如分割线 + 含 `:` 的引用块）时，会把这些合法正文误判为 front matter 并静默删除（数据丢失）。
        let content = read_note_content_or_fallback(&existing);

        let title = params["title"].as_str().unwrap_or(&existing.title);
        let category = params["category"].as_str().unwrap_or(&existing.category);
        let tags: Vec<String> = if params["tags"].is_array() {
            params["tags"].as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or(existing.tags.clone())
        } else {
            existing.tags.clone()
        };

        let note = notebook.update_note(note_id, title, &content, &existing.group_id, category, tags)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Retagged note '{}' (tags: {}, category: {})", note.title, note.tags.join(", "), note.category),
            metadata: json!({
                "id": note.id,
                "tags": note.tags,
                "category": note.category,
            }),
        })
    }

    async fn action_move(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for move".to_string())?;
        let group_id = params["group_id"].as_str()
            .ok_or_else(|| "Missing 'group_id' parameter for move".to_string())?;

        let existing = NoteRepo::get_by_id(&self.db, note_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Note not found".to_string())?;

        // 文件缺失时回退到 DB 冗余列，避免把正文静默清空（P0-3/数据丢失）。
        // 同 action_retag：read_note 已剥离 front matter，无需再跑 strip_leading_front_matter
        // （否则正文以 "---...---" 块开头时会被误删）。
        let content = read_note_content_or_fallback(&existing);

        let category = params["category"].as_str().unwrap_or(&existing.category);

        let note = notebook.update_note(note_id, &existing.title, &content, group_id, category, existing.tags.clone())?;

        Ok(ToolOutput {
            success: true,
            result: format!("Moved note '{}' to group '{}' (category: {})", note.title, note.group_id, note.category),
            metadata: json!({
                "id": note.id,
                "groupId": note.group_id,
                "category": note.category,
            }),
        })
    }

    async fn action_link_command(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let note_id = params["note_id"].as_str()
            .ok_or_else(|| "Missing 'note_id' parameter for link_command".to_string())?;
        let command_id = params["command_id"].as_str()
            .ok_or_else(|| "Missing 'command_id' parameter for link_command".to_string())?;
        // context 优先用显式 command_text；缺失时从命令历史反查真实命令文本，
        // 仅在两者都无时才兜底为 command_id（避免 context 退化成 UUID，P2-6）。
        let command_text = params["command_text"].as_str()
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .or_else(|| crate::infra::storage::command_repo::CommandRepo::get_command_text(&self.db, command_id).ok().flatten())
            .unwrap_or_else(|| command_id.to_string());

        notebook.link_command(note_id, command_id, &command_text)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Linked command '{}' to note '{}'", command_id, note_id),
            metadata: json!({
                "noteId": note_id,
                "commandId": command_id,
            }),
        })
    }

    async fn action_list_groups(&self) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let groups = notebook.list_groups()?;

        let results: Vec<Value> = groups.iter().map(|g| json!({
            "id": g.id,
            "name": g.name,
            "icon": g.icon,
            "color": g.color,
        })).collect();

        Ok(ToolOutput {
            success: true,
            result: format!("Available groups ({}):\n{}", results.len(),
                results.iter().map(|r| format!("- {} {} ({})", r["icon"], r["name"], r["id"])).collect::<Vec<_>>().join("\n")),
            metadata: json!({ "results": results }),
        })
    }

    async fn action_list_categories(&self, params: &Value) -> Result<ToolOutput, String> {
        let notebook = self.get_notebook()?;

        let group_id = params["group_id"].as_str()
            .ok_or_else(|| "Missing 'group_id' parameter for list_categories".to_string())?;

        let categories = notebook.list_categories_by_group(group_id)?;

        let results: Vec<Value> = categories.iter().map(|c| json!({
            "id": c.id,
            "name": c.name,
        })).collect();

        Ok(ToolOutput {
            success: true,
            result: format!("Categories in group '{}' ({}):\n{}", group_id, results.len(),
                results.iter().map(|r| format!("- {} ({})", r["name"], r["id"])).collect::<Vec<_>>().join("\n")),
            metadata: json!({ "results": results }),
        })
    }
}
