use std::sync::Arc;
use tauri::State;

use crate::app::icon_service::IconService;
use crate::infra::storage::icon_repo::{IconGroupRow, CustomIconRow};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconGroupDto {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<IconGroupRow> for IconGroupDto {
    fn from(g: IconGroupRow) -> Self {
        IconGroupDto {
            id: g.id,
            name: g.name,
            parent_id: g.parent_id,
            sort_order: g.sort_order,
            created_at: g.created_at,
            updated_at: g.updated_at,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomIconDto {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub file_type: String,
    pub group_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<CustomIconRow> for CustomIconDto {
    fn from(i: CustomIconRow) -> Self {
        CustomIconDto {
            id: i.id,
            name: i.name,
            file_path: i.file_path,
            file_type: i.file_type,
            group_id: i.group_id,
            created_at: i.created_at,
            updated_at: i.updated_at,
        }
    }
}

#[tauri::command]
pub fn list_icon_groups(service: State<'_, Arc<IconService>>) -> Result<Vec<IconGroupDto>, String> {
    let groups = service.list_groups()?;
    Ok(groups.into_iter().map(|g| g.into()).collect())
}

#[tauri::command]
pub fn create_icon_group(
    service: State<'_, Arc<IconService>>,
    name: String,
    parent_id: Option<String>,
    sort_order: i64,
) -> Result<IconGroupDto, String> {
    let group = service.create_group(&name, parent_id.as_deref(), sort_order)?;
    Ok(group.into())
}

#[tauri::command]
pub fn update_icon_group(
    service: State<'_, Arc<IconService>>,
    id: String,
    name: String,
    parent_id: Option<String>,
    sort_order: i64,
) -> Result<IconGroupDto, String> {
    let group = service.update_group(&id, &name, parent_id.as_deref(), sort_order)?;
    Ok(group.into())
}

#[tauri::command]
pub fn delete_icon_group(service: State<'_, Arc<IconService>>, id: String) -> Result<(), String> {
    service.delete_group(&id)
}

#[tauri::command]
pub fn list_custom_icons(service: State<'_, Arc<IconService>>, group_id: Option<String>) -> Result<Vec<CustomIconDto>, String> {
    let icons = service.list_icons(group_id.as_deref())?;
    Ok(icons.into_iter().map(|i| i.into()).collect())
}

#[tauri::command]
pub fn upload_custom_icon(
    service: State<'_, Arc<IconService>>,
    name: String,
    group_id: String,
    file_data: Vec<u8>,
    file_name: String,
) -> Result<CustomIconDto, String> {
    let icon = service.upload_icon(&name, &group_id, &file_data, &file_name)?;
    Ok(icon.into())
}

#[tauri::command]
pub fn delete_custom_icon(service: State<'_, Arc<IconService>>, id: String) -> Result<(), String> {
    service.delete_icon(&id)
}

#[tauri::command]
pub fn get_custom_icon_urls(service: State<'_, Arc<IconService>>) -> Result<std::collections::HashMap<String, String>, String> {
    service.get_all_icon_urls()
}

#[tauri::command]
pub fn get_custom_icon_url(
    service: State<'_, Arc<IconService>>,
    id: String,
) -> Result<Option<String>, String> {
    service.get_icon_url_by_id(&id)
}
