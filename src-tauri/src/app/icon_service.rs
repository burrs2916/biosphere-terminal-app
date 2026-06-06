#![allow(dead_code)]

use std::path::PathBuf;
use std::fs;
use std::sync::Arc;
use base64::Engine;

use crate::infra::storage::database::Database;
use crate::infra::storage::icon_repo::{IconGroupRepo, IconGroupRow, CustomIconRepo, CustomIconRow};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct IconService {
    pub db: Arc<Database>,
    icons_dir: PathBuf,
}

impl IconService {
    pub fn new(db: Arc<Database>, icons_dir: PathBuf) -> Self {
        fs::create_dir_all(&icons_dir).ok();
        Self { db, icons_dir }
    }

    pub fn list_groups(&self) -> Result<Vec<IconGroupRow>, String> {
        IconGroupRepo::list(&self.db)
    }

    pub fn create_group(&self, name: &str, parent_id: Option<&str>, sort_order: i64) -> Result<IconGroupRow, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let group = IconGroupRow {
            id,
            name: name.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            sort_order,
            created_at: now,
            updated_at: now,
        };
        IconGroupRepo::save(&self.db, &group)?;
        Ok(group)
    }

    pub fn update_group(&self, id: &str, name: &str, parent_id: Option<&str>, sort_order: i64) -> Result<IconGroupRow, String> {
        let mut group = IconGroupRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Icon group not found".to_string())?;
        group.name = name.to_string();
        group.parent_id = parent_id.map(|s| s.to_string());
        group.sort_order = sort_order;
        group.updated_at = now_ms();
        IconGroupRepo::save(&self.db, &group)?;
        Ok(group)
    }

    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        let group_dir = self.icons_dir.join(id);
        if group_dir.exists() {
            let _ = fs::remove_dir_all(&group_dir);
        }
        CustomIconRepo::delete_by_group(&self.db, id)?;
        IconGroupRepo::delete(&self.db, id)
    }

    pub fn list_icons(&self, group_id: Option<&str>) -> Result<Vec<CustomIconRow>, String> {
        match group_id {
            Some(gid) => CustomIconRepo::list_by_group(&self.db, gid),
            None => CustomIconRepo::list(&self.db),
        }
    }

    pub fn get_icon(&self, id: &str) -> Result<Option<CustomIconRow>, String> {
        CustomIconRepo::get_by_id(&self.db, id)
    }

    pub fn upload_icon(&self, name: &str, group_id: &str, file_data: &[u8], file_name: &str) -> Result<CustomIconRow, String> {
        if file_data.len() > 512 * 1024 {
            return Err("Icon file size cannot exceed 512KB".to_string());
        }

        let group = IconGroupRepo::get_by_id(&self.db, group_id)?;
        if group.is_none() {
            return Err("Icon group not found".to_string());
        }

        let file_ext = file_name.split('.').last().unwrap_or("svg").to_lowercase();
        let id = format!("icon_{}", uuid::Uuid::new_v4().to_string().replace("-", ""));
        let save_file_name = format!("{}.{}", id, file_ext);

        let group_dir = self.icons_dir.join(group_id);
        fs::create_dir_all(&group_dir)
            .map_err(|e| format!("Failed to create icon directory: {}", e))?;

        let file_path = group_dir.join(&save_file_name);
        fs::write(&file_path, file_data)
            .map_err(|e| format!("Failed to write icon file: {}", e))?;

        let relative_path = format!("{}/{}", group_id, save_file_name);
        let now = now_ms();

        let icon = CustomIconRow {
            id,
            name: name.to_string(),
            file_path: relative_path,
            file_type: file_ext,
            group_id: group_id.to_string(),
            created_at: now,
            updated_at: now,
        };
        CustomIconRepo::save(&self.db, &icon)?;
        Ok(icon)
    }

    pub fn delete_icon(&self, id: &str) -> Result<(), String> {
        let icon = CustomIconRepo::get_by_id(&self.db, id)?;
        CustomIconRepo::delete(&self.db, id)?;

        if let Some(icon) = icon {
            let full_path = self.icons_dir.join(&icon.file_path);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
        }
        Ok(())
    }

    pub fn get_icon_file_data(&self, file_path: &str) -> Result<(Vec<u8>, String), String> {
        let full_path = self.icons_dir.join(file_path);
        if !full_path.exists() {
            return Err("Icon file not found".to_string());
        }

        let data = fs::read(&full_path)
            .map_err(|e| format!("Failed to read icon file: {}", e))?;

        let ext = full_path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("svg")
            .to_lowercase();

        let mime = match ext.as_str() {
            "svg" => "image/svg+xml".to_string(),
            "png" => "image/png".to_string(),
            "jpg" | "jpeg" => "image/jpeg".to_string(),
            "gif" => "image/gif".to_string(),
            "webp" => "image/webp".to_string(),
            _ => "application/octet-stream".to_string(),
        };

        Ok((data, mime))
    }

    pub fn get_all_icon_urls(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let icons = CustomIconRepo::list(&self.db)?;
        let mut urls = std::collections::HashMap::new();
        let mut total_bytes: usize = 0;
        let mut skipped: usize = 0;

        // Cap inline batch payload at ~4MB to keep IPC responsive on first paint.
        // Icons exceeding this budget are skipped here and must be fetched on demand
        // via `get_custom_icon_url(id)`.
        const MAX_BATCH_BYTES: usize = 4 * 1024 * 1024;
        const MAX_SINGLE_ICON: usize = 256 * 1024;

        for icon in &icons {
            if let Ok((data, mime)) = self.get_icon_file_data(&icon.file_path) {
                if data.len() > MAX_SINGLE_ICON || total_bytes + data.len() > MAX_BATCH_BYTES {
                    skipped += 1;
                    continue;
                }
                total_bytes += data.len();
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                urls.insert(icon.id.clone(), format!("data:{};base64,{}", mime, b64));
            }
        }

        if skipped > 0 {
            tracing::info!(
                "[IconService] batch returned {} icons ({} bytes), skipped {} large icons (fetch on demand)",
                urls.len(),
                total_bytes,
                skipped
            );
        }
        Ok(urls)
    }

    /// Read a single icon's data URL by icon id. Used for lazy-loading large icons
    /// that were skipped by `get_all_icon_urls`.
    pub fn get_icon_url_by_id(&self, id: &str) -> Result<Option<String>, String> {
        let icon = CustomIconRepo::get_by_id(&self.db, id)?;
        let icon = match icon {
            Some(i) => i,
            None => return Ok(None),
        };
        let (data, mime) = self.get_icon_file_data(&icon.file_path)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        Ok(Some(format!("data:{};base64,{}", mime, b64)))
    }
}
