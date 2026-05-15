use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app::notebook_service::NotebookService;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
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
pub struct NoteDetailDto {
    pub note: NoteDto,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteInput {
    pub title: String,
    pub content: String,
    pub group_id: String,
    pub category: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteInput {
    pub id: String,
    pub title: String,
    pub content: String,
    pub group_id: String,
    pub category: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCommandInput {
    pub note_id: String,
    pub command_id: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteGroupDto {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
    pub note_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupInput {
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGroupInput {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
}

fn to_note_dto(n: &crate::infra::storage::note_repo::NoteRow) -> NoteDto {
    NoteDto {
        id: n.id.clone(),
        title: n.title.clone(),
        file_path: n.file_path.clone(),
        group_id: n.group_id.clone(),
        category: n.category.clone(),
        tags: n.tags.clone(),
        word_count: n.word_count,
        is_pinned: n.is_pinned,
        created_at: n.created_at,
        updated_at: n.updated_at,
    }
}

#[tauri::command]
pub fn list_notes(
    service: State<'_, Arc<NotebookService>>,
    group_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<NoteDto>, String> {
    let notes = service.list_notes(
        group_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
    )?;
    Ok(notes.iter().map(to_note_dto).collect())
}

#[tauri::command]
pub fn get_note(
    service: State<'_, Arc<NotebookService>>,
    id: String,
) -> Result<Option<NoteDetailDto>, String> {
    let result = service.get_note(&id)?;
    Ok(result.map(|(note, content)| NoteDetailDto {
        note: to_note_dto(&note),
        content,
    }))
}

#[tauri::command]
pub fn create_note(
    service: State<'_, Arc<NotebookService>>,
    input: CreateNoteInput,
) -> Result<NoteDto, String> {
    let note = service.create_note(
        &input.title,
        &input.content,
        &input.group_id,
        &input.category,
        input.tags,
    )?;
    Ok(to_note_dto(&note))
}

#[tauri::command]
pub fn update_note(
    service: State<'_, Arc<NotebookService>>,
    input: UpdateNoteInput,
) -> Result<NoteDto, String> {
    let note = service.update_note(
        &input.id,
        &input.title,
        &input.content,
        &input.group_id,
        &input.category,
        input.tags,
    )?;
    Ok(to_note_dto(&note))
}

#[tauri::command]
pub fn delete_note(
    service: State<'_, Arc<NotebookService>>,
    id: String,
) -> Result<(), String> {
    service.delete_note(&id)
}

#[tauri::command]
pub fn toggle_pin_note(
    service: State<'_, Arc<NotebookService>>,
    id: String,
) -> Result<NoteDto, String> {
    let note = service.toggle_pin(&id)?;
    Ok(to_note_dto(&note))
}

#[tauri::command]
pub fn search_notes(
    service: State<'_, Arc<NotebookService>>,
    query: String,
) -> Result<Vec<NoteDto>, String> {
    let notes = service.search_notes(&query)?;
    Ok(notes.iter().map(to_note_dto).collect())
}

#[tauri::command]
pub fn list_note_categories(
    service: State<'_, Arc<NotebookService>>,
) -> Result<Vec<String>, String> {
    service.list_categories()
}

#[tauri::command]
pub fn link_command_to_note(
    service: State<'_, Arc<NotebookService>>,
    input: LinkCommandInput,
) -> Result<(), String> {
    service.link_command(&input.note_id, &input.command_id, &input.context)
}

#[tauri::command]
pub fn get_linked_commands(
    service: State<'_, Arc<NotebookService>>,
    note_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let links = service.get_linked_commands(&note_id)?;
    Ok(links.iter().map(|l| serde_json::json!({
        "id": l.id,
        "commandId": l.command_id,
        "noteId": l.note_id,
        "context": l.context,
        "createdAt": l.created_at,
    })).collect())
}

#[tauri::command]
pub fn get_linked_notes(
    service: State<'_, Arc<NotebookService>>,
    command_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let links = service.get_linked_notes(&command_id)?;
    Ok(links.iter().map(|l| serde_json::json!({
        "id": l.id,
        "commandId": l.command_id,
        "noteId": l.note_id,
        "context": l.context,
        "createdAt": l.created_at,
    })).collect())
}

#[tauri::command]
pub fn get_notes_for_command_text(
    linker: State<'_, Arc<crate::app::linker_service::LinkerService>>,
    command_text: String,
) -> Result<Vec<serde_json::Value>, String> {
    linker.get_notes_for_command_text(&command_text)
}

#[tauri::command]
pub fn list_note_groups(
    service: State<'_, Arc<NotebookService>>,
) -> Result<Vec<NoteGroupDto>, String> {
    let groups = service.list_groups()?;
    let mut dtos = Vec::new();
    for g in &groups {
        let note_count = crate::infra::storage::note_repo::NoteRepo::count_by_group(&service.db, &g.id)?;
        dtos.push(NoteGroupDto {
            id: g.id.clone(),
            name: g.name.clone(),
            icon: g.icon.clone(),
            color: g.color.clone(),
            sort_order: g.sort_order,
            note_count,
            created_at: g.created_at,
            updated_at: g.updated_at,
        });
    }
    Ok(dtos)
}

#[tauri::command]
pub fn create_note_group(
    service: State<'_, Arc<NotebookService>>,
    input: CreateGroupInput,
) -> Result<NoteGroupDto, String> {
    let group = service.create_group(&input.name, &input.icon, &input.color, input.sort_order)?;
    Ok(NoteGroupDto {
        id: group.id,
        name: group.name,
        icon: group.icon,
        color: group.color,
        sort_order: group.sort_order,
        note_count: 0,
        created_at: group.created_at,
        updated_at: group.updated_at,
    })
}

#[tauri::command]
pub fn update_note_group(
    service: State<'_, Arc<NotebookService>>,
    input: UpdateGroupInput,
) -> Result<NoteGroupDto, String> {
    let group = service.update_group(&input.id, &input.name, &input.icon, &input.color, input.sort_order)?;
    let note_count = crate::infra::storage::note_repo::NoteRepo::count_by_group(&service.db, &group.id)?;
    Ok(NoteGroupDto {
        id: group.id,
        name: group.name,
        icon: group.icon,
        color: group.color,
        sort_order: group.sort_order,
        note_count,
        created_at: group.created_at,
        updated_at: group.updated_at,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCategoryDto {
    pub id: String,
    pub name: String,
    pub group_id: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryInput {
    pub name: String,
    pub group_id: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryInput {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

fn to_category_dto(c: &crate::infra::storage::note_repo::NoteCategoryRow) -> NoteCategoryDto {
    NoteCategoryDto {
        id: c.id.clone(),
        name: c.name.clone(),
        group_id: c.group_id.clone(),
        is_default: c.is_default,
        sort_order: c.sort_order,
        created_at: c.created_at,
        updated_at: c.updated_at,
    }
}

#[tauri::command]
pub fn list_note_categories_by_group(
    service: State<'_, Arc<NotebookService>>,
    group_id: String,
) -> Result<Vec<NoteCategoryDto>, String> {
    let cats = service.list_categories_by_group(&group_id)?;
    Ok(cats.iter().map(to_category_dto).collect())
}

#[tauri::command]
pub fn create_note_category(
    service: State<'_, Arc<NotebookService>>,
    input: CreateCategoryInput,
) -> Result<NoteCategoryDto, String> {
    let cat = service.create_category(&input.name, &input.group_id, input.sort_order)?;
    Ok(to_category_dto(&cat))
}

#[tauri::command]
pub fn update_note_category(
    service: State<'_, Arc<NotebookService>>,
    input: UpdateCategoryInput,
) -> Result<NoteCategoryDto, String> {
    let cat = service.update_category(&input.id, &input.name, input.sort_order)?;
    Ok(to_category_dto(&cat))
}

#[tauri::command]
pub fn delete_note_category(
    service: State<'_, Arc<NotebookService>>,
    id: String,
) -> Result<(), String> {
    service.delete_category(&id)
}

#[tauri::command]
pub fn delete_note_group(
    service: State<'_, Arc<NotebookService>>,
    id: String,
) -> Result<(), String> {
    service.delete_group(&id)
}

#[tauri::command]
pub fn unlink_command_note(
    linker: State<'_, Arc<crate::app::linker_service::LinkerService>>,
    link_id: String,
) -> Result<(), String> {
    linker.unlink(&link_id)
}
