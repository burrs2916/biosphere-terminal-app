#![allow(dead_code)]

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::infra::storage::database::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub group_id: String,
    pub category: String,
    pub tags: Vec<String>,
    pub word_count: i64,
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteGroupRow {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandNoteLinkRow {
    pub id: String,
    pub command_id: String,
    pub note_id: String,
    pub context: String,
    pub created_at: i64,
}

pub struct NoteRepo;

impl NoteRepo {
    pub fn list(db: &Database, group_id: Option<&str>, category: Option<&str>, search: Option<&str>) -> Result<Vec<NoteRow>, String> {
        let conn = db.conn();

        let mut sql = String::from(
            "SELECT id, title, file_path, group_id, category, tags, word_count, is_pinned, created_at, updated_at FROM notes WHERE 1=1"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(gid) = group_id {
            if !gid.is_empty() {
                sql.push_str(" AND group_id = ?");
                param_values.push(Box::new(gid.to_string()));
            }
        }

        if let Some(cat) = category {
            if !cat.is_empty() {
                sql.push_str(" AND category = ?");
                param_values.push(Box::new(cat.to_string()));
            }
        }

        if let Some(q) = search {
            if !q.is_empty() {
                sql.push_str(" AND (title LIKE ? OR tags LIKE ?)");
                let like = format!("%{}%", q);
                param_values.push(Box::new(like.clone()));
                param_values.push(Box::new(like));
            }
        }

        sql.push_str(" ORDER BY is_pinned DESC, updated_at DESC");

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let tags_str: String = row.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let pinned: i32 = row.get(7)?;
                Ok(NoteRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    group_id: row.get(3)?,
                    category: row.get(4)?,
                    tags,
                    word_count: row.get(6)?,
                    is_pinned: pinned != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<NoteRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, file_path, group_id, category, tags, word_count, is_pinned, created_at, updated_at FROM notes WHERE id = ?1"
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row(params![id], |row| {
                let tags_str: String = row.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let pinned: i32 = row.get(7)?;
                Ok(NoteRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    group_id: row.get(3)?,
                    category: row.get(4)?,
                    tags,
                    word_count: row.get(6)?,
                    is_pinned: pinned != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .ok();

        Ok(result)
    }

    pub fn save(db: &Database, note: &NoteRow) -> Result<(), String> {
        let conn = db.conn();
        let tags_json = serde_json::to_string(&note.tags).unwrap_or_else(|_| "[]".to_string());
        let pinned = if note.is_pinned { 1 } else { 0 };

        conn.execute(
            "INSERT OR REPLACE INTO notes (id, title, file_path, group_id, category, tags, word_count, is_pinned, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![note.id, note.title, note.file_path, note.group_id, note.category, tags_json, note.word_count, pinned, note.created_at, note.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM command_note_links WHERE note_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_by_group(db: &Database, group_id: &str) -> Result<Vec<NoteRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, file_path, group_id, category, tags, word_count, is_pinned, created_at, updated_at FROM notes WHERE group_id = ?1 ORDER BY updated_at DESC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![group_id], |row| {
                let tags_str: String = row.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let pinned: i32 = row.get(7)?;
                Ok(NoteRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    group_id: row.get(3)?,
                    category: row.get(4)?,
                    tags,
                    word_count: row.get(6)?,
                    is_pinned: pinned != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_category(db: &Database, category: &str) -> Result<Vec<NoteRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, file_path, group_id, category, tags, word_count, is_pinned, created_at, updated_at FROM notes WHERE category = ?1 ORDER BY updated_at DESC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![category], |row| {
                let tags_str: String = row.get(5)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                let pinned: i32 = row.get(7)?;
                Ok(NoteRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    group_id: row.get(3)?,
                    category: row.get(4)?,
                    tags,
                    word_count: row.get(6)?,
                    is_pinned: pinned != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_categories(db: &Database) -> Result<Vec<String>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT DISTINCT category FROM notes WHERE category != '' ORDER BY category")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_categories_by_group(db: &Database, group_id: &str) -> Result<Vec<String>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT DISTINCT category FROM notes WHERE group_id = ?1 AND category != '' ORDER BY category")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![group_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn count_by_group(db: &Database, group_id: &str) -> Result<i64, String> {
        let conn = db.conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE group_id = ?1",
                params![group_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn delete_by_group(db: &Database, group_id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM command_note_links WHERE note_id IN (SELECT id FROM notes WHERE group_id = ?1)", params![group_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM notes WHERE group_id = ?1", params![group_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_by_category(db: &Database, category: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM command_note_links WHERE note_id IN (SELECT id FROM notes WHERE category = ?1)", params![category])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM notes WHERE category = ?1", params![category])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct NoteGroupRepo;

impl NoteGroupRepo {
    pub fn list(db: &Database) -> Result<Vec<NoteGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, icon, color, sort_order, created_at, updated_at FROM note_groups ORDER BY sort_order ASC, name ASC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(NoteGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<NoteGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, icon, color, sort_order, created_at, updated_at FROM note_groups WHERE id = ?1"
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row(params![id], |row| {
                Ok(NoteGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .ok();

        Ok(result)
    }

    pub fn save(db: &Database, group: &NoteGroupRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO note_groups (id, name, icon, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![group.id, group.name, group.icon, group.color, group.sort_order, group.created_at, group.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM note_groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct CommandNoteLinkRepo;

impl CommandNoteLinkRepo {
    pub fn list_by_note(db: &Database, note_id: &str) -> Result<Vec<CommandNoteLinkRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, command_id, note_id, context, created_at FROM command_note_links WHERE note_id = ?1 ORDER BY created_at DESC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![note_id], |row| {
                Ok(CommandNoteLinkRow {
                    id: row.get(0)?,
                    command_id: row.get(1)?,
                    note_id: row.get(2)?,
                    context: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_command(db: &Database, command_id: &str) -> Result<Vec<CommandNoteLinkRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, command_id, note_id, context, created_at FROM command_note_links WHERE command_id = ?1 ORDER BY created_at DESC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![command_id], |row| {
                Ok(CommandNoteLinkRow {
                    id: row.get(0)?,
                    command_id: row.get(1)?,
                    note_id: row.get(2)?,
                    context: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_command_text(db: &Database, command_text: &str) -> Result<Vec<CommandNoteLinkRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, command_id, note_id, context, created_at FROM command_note_links WHERE context = ?1 ORDER BY created_at DESC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![command_text], |row| {
                Ok(CommandNoteLinkRow {
                    id: row.get(0)?,
                    command_id: row.get(1)?,
                    note_id: row.get(2)?,
                    context: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn create(db: &Database, link: &CommandNoteLinkRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO command_note_links (id, command_id, note_id, context, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![link.id, link.command_id, link.note_id, link.context, link.created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM command_note_links WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCategoryRow {
    pub id: String,
    pub name: String,
    pub group_id: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct NoteCategoryRepo;

impl NoteCategoryRepo {
    pub fn list_by_group(db: &Database, group_id: &str) -> Result<Vec<NoteCategoryRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, group_id, is_default, sort_order, created_at, updated_at FROM note_categories WHERE group_id = ?1 ORDER BY sort_order ASC, name ASC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![group_id], |row| {
                let is_default: i32 = row.get(3)?;
                Ok(NoteCategoryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    group_id: row.get(2)?,
                    is_default: is_default != 0,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<NoteCategoryRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, group_id, is_default, sort_order, created_at, updated_at FROM note_categories WHERE id = ?1"
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row(params![id], |row| {
                let is_default: i32 = row.get(3)?;
                Ok(NoteCategoryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    group_id: row.get(2)?,
                    is_default: is_default != 0,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .ok();

        Ok(result)
    }

    pub fn save(db: &Database, cat: &NoteCategoryRow) -> Result<(), String> {
        let conn = db.conn();
        let is_default = if cat.is_default { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO note_categories (id, name, group_id, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![cat.id, cat.name, cat.group_id, is_default, cat.sort_order, cat.created_at, cat.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM note_categories WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_by_group(db: &Database, group_id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM note_categories WHERE group_id = ?1", params![group_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn count_by_group(db: &Database, group_id: &str) -> Result<i64, String> {
        let conn = db.conn();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_categories WHERE group_id = ?1",
                params![group_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count)
    }
}
