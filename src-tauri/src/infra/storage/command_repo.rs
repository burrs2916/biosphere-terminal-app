use crate::core::error::Result;
use crate::core::types::{CommandHistoryEntry, CommandSnippet, LinkedNoteInfo};
use crate::infra::storage::database::Database;

pub struct CommandRepo;

impl CommandRepo {
    /// 按 id 取命令文本（用于关联笔记时反查可读的 context，避免退化成 UUID）。
    pub fn get_command_text(db: &Database, id: &str) -> Result<Option<String>> {
        let conn = db.conn();
        let mut stmt = conn.prepare("SELECT command FROM command_history WHERE id = ?1")?;
        let mut rows = stmt.query_map(rusqlite::params![id], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(Ok(cmd)) => Ok(Some(cmd)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    pub fn list(db: &Database, limit: usize) -> Result<Vec<CommandHistoryEntry>> {
        let entries: Vec<CommandHistoryEntry> = {
            let conn = db.conn();
            let mut stmt = conn.prepare(
                "SELECT id, session_id, command, cwd, exit_code, executed_at, \
                 EXISTS(SELECT 1 FROM command_note_links WHERE command_id = command_history.id) as linked \
                 FROM command_history ORDER BY executed_at DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map(rusqlite::params![limit as i64], |row| {
                let linked: i32 = row.get(6)?;
                Ok(CommandHistoryEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    command: row.get(2)?,
                    cwd: row.get(3)?,
                    exit_code: row.get(4)?,
                    executed_at: row.get(5)?,
                    linked: linked != 0,
                    linked_notes: Vec::new(),
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        Self::attach_linked_notes(db, entries)
    }

    pub fn save(db: &Database, entry: &CommandHistoryEntry) -> Result<()> {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO command_history (id, session_id, command, cwd, exit_code, executed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                entry.id,
                entry.session_id,
                entry.command,
                entry.cwd,
                entry.exit_code,
                entry.executed_at,
            ],
        )?;
        Ok(())
    }

    pub fn search(db: &Database, query: &str) -> Result<Vec<CommandHistoryEntry>> {
        let entries: Vec<CommandHistoryEntry> = {
            let conn = db.conn();
            let mut stmt = conn.prepare(
                "SELECT id, session_id, command, cwd, exit_code, executed_at, \
                 EXISTS(SELECT 1 FROM command_note_links WHERE command_id = command_history.id) as linked \
                 FROM command_history WHERE command LIKE ?1 ORDER BY executed_at DESC LIMIT 100",
            )?;
            let pattern = format!("%{}%", query);
            let rows = stmt.query_map(rusqlite::params![pattern], |row| {
                let linked: i32 = row.get(6)?;
                Ok(CommandHistoryEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    command: row.get(2)?,
                    cwd: row.get(3)?,
                    exit_code: row.get(4)?,
                    executed_at: row.get(5)?,
                    linked: linked != 0,
                    linked_notes: Vec::new(),
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        Self::attach_linked_notes(db, entries)
    }

    fn attach_linked_notes(db: &Database, entries: Vec<CommandHistoryEntry>) -> Result<Vec<CommandHistoryEntry>> {
        let linked_ids: Vec<String> = entries
            .iter()
            .filter(|e| e.linked)
            .map(|e| e.id.clone())
            .collect();

        if linked_ids.is_empty() {
            return Ok(entries);
        }

        let conn = db.conn();
        let mut notes_map: std::collections::HashMap<String, Vec<LinkedNoteInfo>> =
            std::collections::HashMap::new();

        let placeholders: Vec<String> = linked_ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT cnl.command_id, cnl.id, cnl.note_id, n.title, n.category, n.group_id \
             FROM command_note_links cnl \
             JOIN notes n ON n.id = cnl.note_id \
             WHERE cnl.command_id IN ({}) \
             ORDER BY cnl.created_at DESC",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::types::ToSql> = linked_ids.iter()
            .map(|c| c as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, LinkedNoteInfo {
                link_id: row.get(1)?,
                note_id: row.get(2)?,
                title: row.get(3)?,
                category: row.get(4)?,
                group_id: row.get(5)?,
            }))
        })?;

        for row in rows {
            let (cmd_id, note) = row?;
            notes_map.entry(cmd_id).or_default().push(note);
        }

        let result = entries
            .into_iter()
            .map(|mut e| {
                if let Some(notes) = notes_map.get(&e.id) {
                    e.linked_notes = notes.clone();
                }
                e
            })
            .collect();

        Ok(result)
    }

    pub fn list_snippets(db: &Database) -> Result<Vec<CommandSnippet>> {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, command, description, tags, created_at FROM snippets ORDER BY created_at DESC",
        )?;
        let snippets = stmt
            .query_map([], |row| {
                let tags_str: String = row.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(CommandSnippet {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    command: row.get(2)?,
                    description: row.get(3)?,
                    tags,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(snippets)
    }

    pub fn save_snippet(db: &Database, snippet: &CommandSnippet) -> Result<()> {
        let conn = db.conn();
        let tags_json = serde_json::to_string(&snippet.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO snippets (id, name, command, description, tags, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                snippet.id,
                snippet.name,
                snippet.command,
                snippet.description,
                tags_json,
                snippet.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_snippet(db: &Database, id: &str) -> Result<()> {
        let conn = db.conn();
        conn.execute("DELETE FROM snippets WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn delete_history(db: &Database, id: &str) -> Result<()> {
        // 注意：不再级联删除 command_note_links。保留孤儿链接，让关联笔记侧能显示
        // "关联命令已删除"的过期提示（R6-4），而不是直接静默丢链。
        let conn = db.conn();
        conn.execute("DELETE FROM command_history WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn clear_history(db: &Database) -> Result<()> {
        // 同上：清空历史时不级联删链接，保留笔记侧的过期引用提示（R6-4）。
        let conn = db.conn();
        conn.execute("DELETE FROM command_history", [])?;
        Ok(())
    }

    pub fn delete_many(db: &Database, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let conn = db.conn();
        // 仅删历史条目本身；关联的 command_note_links 保留为孤儿，由笔记侧提示过期（R6-4）。
        let placeholders: Vec<String> = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let params: Vec<&dyn rusqlite::types::ToSql> = ids.iter()
            .map(|c| c as &dyn rusqlite::types::ToSql)
            .collect();
        let sql2 = format!("DELETE FROM command_history WHERE id IN ({})", placeholders.join(", "));
        conn.execute(&sql2, params.as_slice())?;
        Ok(())
    }
}
