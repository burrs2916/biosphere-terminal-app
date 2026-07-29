#![allow(dead_code)]

use std::sync::Arc;

use crate::app::notebook_service::NotebookService;
use crate::infra::storage::database::Database;
use crate::infra::storage::note_repo::CommandNoteLinkRepo;

pub struct LinkerService {
    notebook: Arc<NotebookService>,
    db: Arc<Database>,
}

impl LinkerService {
    pub fn new(notebook: Arc<NotebookService>, db: Arc<Database>) -> Self {
        LinkerService { notebook, db }
    }

    pub fn link_command_to_note(&self, command_id: &str, note_id: &str, context: &str) -> Result<(), String> {
        self.notebook.link_command(note_id, command_id, context)
    }

    pub fn get_notes_for_command(&self, command_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let links = self.notebook.get_linked_notes(command_id)?;
        let mut notes = Vec::new();
        for link in links {
            if let Ok(Some((note, _))) = self.notebook.get_note(&link.note_id) {
                notes.push(serde_json::json!({
                    "linkId": link.id,
                    "noteId": note.id,
                    "title": note.title,
                    "category": note.category,
                    "context": link.context,
                    "createdAt": link.created_at,
                }));
            }
        }
        Ok(notes)
    }

    pub fn get_notes_for_command_text(&self, command_text: &str) -> Result<Vec<serde_json::Value>, String> {
        let links = CommandNoteLinkRepo::list_by_command_text(&self.db, command_text)?;
        let mut notes = Vec::new();
        for link in links {
            if let Ok(Some((note, _))) = self.notebook.get_note(&link.note_id) {
                notes.push(serde_json::json!({
                    "linkId": link.id,
                    "noteId": note.id,
                    "title": note.title,
                    "category": note.category,
                    "groupId": note.group_id,
                    "context": link.context,
                    "createdAt": link.created_at,
                }));
            }
        }
        Ok(notes)
    }

    pub fn get_commands_for_note(&self, note_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let links = self.notebook.get_linked_commands(note_id)?;
        let mut commands = Vec::new();
        for link in links {
            commands.push(serde_json::json!({
                "linkId": link.id,
                "commandId": link.command_id,
                "context": link.context,
                "createdAt": link.created_at,
            }));
        }
        Ok(commands)
    }

    pub fn unlink(&self, link_id: &str) -> Result<(), String> {
        CommandNoteLinkRepo::delete(&self.db, link_id)?;
        self.notebook.notify_links_changed();
        Ok(())
    }
}
