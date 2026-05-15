#![allow(dead_code)]

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::infra::storage::database::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconGroupRow {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomIconRow {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub file_type: String,
    pub group_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct IconGroupRepo;

impl IconGroupRepo {
    pub fn list(db: &Database) -> Result<Vec<IconGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM icon_groups ORDER BY sort_order ASC, name ASC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(IconGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<IconGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM icon_groups WHERE id = ?1"
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row(params![id], |row| {
                Ok(IconGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .ok();

        Ok(result)
    }

    pub fn save(db: &Database, group: &IconGroupRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO icon_groups (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![group.id, group.name, group.parent_id, group.sort_order, group.created_at, group.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM icon_groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct CustomIconRepo;

impl CustomIconRepo {
    pub fn list(db: &Database) -> Result<Vec<CustomIconRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, file_path, file_type, group_id, created_at, updated_at FROM custom_icons ORDER BY name ASC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(CustomIconRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    file_type: row.get(3)?,
                    group_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_group(db: &Database, group_id: &str) -> Result<Vec<CustomIconRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, file_path, file_type, group_id, created_at, updated_at FROM custom_icons WHERE group_id = ?1 ORDER BY name ASC"
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![group_id], |row| {
                Ok(CustomIconRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    file_type: row.get(3)?,
                    group_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<CustomIconRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, file_path, file_type, group_id, created_at, updated_at FROM custom_icons WHERE id = ?1"
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row(params![id], |row| {
                Ok(CustomIconRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    file_type: row.get(3)?,
                    group_id: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .ok();

        Ok(result)
    }

    pub fn save(db: &Database, icon: &CustomIconRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO custom_icons (id, name, file_path, file_type, group_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![icon.id, icon.name, icon.file_path, icon.file_type, icon.group_id, icon.created_at, icon.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM custom_icons WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_by_group(db: &Database, group_id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM custom_icons WHERE group_id = ?1", params![group_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
