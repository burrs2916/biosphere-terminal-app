use std::path::PathBuf;
use std::sync::Arc;

use crate::infra::filesystem::note_fs::{NoteFileSystem, NoteFrontMatter, LinkedCommandRef};
use crate::infra::storage::database::Database;
use crate::infra::storage::note_repo::{NoteRepo, NoteRow, NoteGroupRepo, NoteGroupRow, CommandNoteLinkRepo, CommandNoteLinkRow, NoteCategoryRepo, NoteCategoryRow};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct NotebookService {
    fs: NoteFileSystem,
    pub db: Arc<Database>,
}

impl NotebookService {
    pub fn new(notes_dir: PathBuf, db: Arc<Database>) -> Self {
        let fs = NoteFileSystem::new(&notes_dir);
        let _ = fs.ensure_dirs();
        let service = NotebookService { fs, db };
        let _ = service.ensure_default_groups();
        service
    }

    fn ensure_default_groups(&self) -> Result<(), String> {
        let existing = NoteGroupRepo::list(&self.db)?;
        if !existing.is_empty() {
            return Ok(());
        }

        let defaults = vec![
            ("linux", "Linux", "🐧", "#4FC3F7", 0),
            ("database", "Database", "🗄️", "#CE93D8", 1),
            ("devops", "DevOps", "🔧", "#FFD740", 2),
            ("docker", "Docker", "🐳", "#4DD0E1", 3),
            ("kubernetes", "Kubernetes", "☸️", "#6C63FF", 4),
            ("network", "Network", "🌐", "#81C784", 5),
            ("programming", "Programming", "💻", "#FF8A80", 6),
            ("snippet", "Snippet", "⚡", "#FFD740", 7),
        ];

        let now = now_ms();
        for (id, name, icon, color, sort_order) in &defaults {
            let group = NoteGroupRow {
                id: id.to_string(),
                name: name.to_string(),
                icon: icon.to_string(),
                color: color.to_string(),
                sort_order: *sort_order,
                created_at: now,
                updated_at: now,
            };
            NoteGroupRepo::save(&self.db, &group)?;
            self.ensure_default_categories_for_group(id)?;
        }

        Ok(())
    }

    fn ensure_default_categories_for_group(&self, group_id: &str) -> Result<(), String> {
        let existing = NoteCategoryRepo::count_by_group(&self.db, group_id)?;
        if existing > 0 {
            return Ok(());
        }

        let default_names = vec!["uncategorized", "snippet", "note", "tutorial", "reference"];
        let now = now_ms();
        for (i, name) in default_names.iter().enumerate() {
            let cat = NoteCategoryRow {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                group_id: group_id.to_string(),
                is_default: true,
                sort_order: i as i64,
                created_at: now,
                updated_at: now,
            };
            NoteCategoryRepo::save(&self.db, &cat)?;
        }
        Ok(())
    }

    pub fn list_notes(&self, group_id: Option<&str>, category: Option<&str>, search: Option<&str>) -> Result<Vec<NoteRow>, String> {
        NoteRepo::list(&self.db, group_id, category, search)
    }

    pub fn get_note(&self, id: &str) -> Result<Option<(NoteRow, String)>, String> {
        let note = NoteRepo::get_by_id(&self.db, id)?;
        match note {
            Some(n) => {
                let file_path = PathBuf::from(&n.file_path);
                if file_path.exists() {
                    let (_, body) = self.fs.read_note(&file_path)
                        .map_err(|e| e.to_string())?;
                    Ok(Some((n, body)))
                } else {
                    Ok(Some((n, String::new())))
                }
            }
            None => Ok(None),
        }
    }

    pub fn create_note(
        &self,
        title: &str,
        content: &str,
        group_id: &str,
        category: &str,
        tags: Vec<String>,
    ) -> Result<NoteRow, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();

        let dir_name = if group_id.is_empty() { "uncategorized" } else { group_id };
        let date_str = Self::format_date(now);
        let file_name = format!("{}-{}.md", date_str, Self::slugify(title));
        let file_path = self.fs.note_path(dir_name, &file_name);

        let front_matter = NoteFrontMatter {
            id: id.clone(),
            title: title.to_string(),
            category: category.to_string(),
            tags: tags.clone(),
            created_at: now,
            updated_at: now,
            linked_commands: Vec::new(),
        };

        self.fs.write_note(&file_path, &front_matter, content)
            .map_err(|e| e.to_string())?;

        let word_count = content.split_whitespace().count() as i64;
        let note = NoteRow {
            id,
            title: title.to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            group_id: group_id.to_string(),
            category: category.to_string(),
            tags,
            word_count,
            is_pinned: false,
            created_at: now,
            updated_at: now,
        };

        NoteRepo::save(&self.db, &note)?;
        Ok(note)
    }

    pub fn update_note(
        &self,
        id: &str,
        title: &str,
        content: &str,
        group_id: &str,
        category: &str,
        tags: Vec<String>,
    ) -> Result<NoteRow, String> {
        let existing = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;

        let now = now_ms();
        let file_path = PathBuf::from(&existing.file_path);

        let links = CommandNoteLinkRepo::list_by_note(&self.db, id)?;
        let linked_commands: Vec<LinkedCommandRef> = links
            .iter()
            .map(|l| LinkedCommandRef {
                id: l.command_id.clone(),
                command: String::new(),
                context: l.context.clone(),
            })
            .collect();

        let front_matter = NoteFrontMatter {
            id: id.to_string(),
            title: title.to_string(),
            category: category.to_string(),
            tags: tags.clone(),
            created_at: existing.created_at,
            updated_at: now,
            linked_commands,
        };

        self.fs.write_note(&file_path, &front_matter, content)
            .map_err(|e| e.to_string())?;

        let word_count = content.split_whitespace().count() as i64;
        let note = NoteRow {
            id: id.to_string(),
            title: title.to_string(),
            file_path: existing.file_path,
            group_id: group_id.to_string(),
            category: category.to_string(),
            tags,
            word_count,
            is_pinned: existing.is_pinned,
            created_at: existing.created_at,
            updated_at: now,
        };

        NoteRepo::save(&self.db, &note)?;
        Ok(note)
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        let note = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;

        let file_path = PathBuf::from(&note.file_path);
        self.fs.delete_note(&file_path).map_err(|e| e.to_string())?;
        NoteRepo::delete(&self.db, id)?;
        Ok(())
    }

    pub fn toggle_pin(&self, id: &str) -> Result<NoteRow, String> {
        let mut note = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;
        note.is_pinned = !note.is_pinned;
        note.updated_at = now_ms();
        NoteRepo::save(&self.db, &note)?;
        Ok(note)
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<NoteRow>, String> {
        let results = self.fs.search_notes(query).map_err(|e| e.to_string())?;
        let mut notes = Vec::new();
        for (_path, fm) in results {
            if let Ok(Some(note)) = NoteRepo::get_by_id(&self.db, &fm.id) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    pub fn list_categories(&self) -> Result<Vec<String>, String> {
        NoteRepo::list_categories(&self.db)
    }

    pub fn link_command(&self, note_id: &str, command_id: &str, context: &str) -> Result<(), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let link = CommandNoteLinkRow {
            id,
            command_id: command_id.to_string(),
            note_id: note_id.to_string(),
            context: context.to_string(),
            created_at: now_ms(),
        };
        CommandNoteLinkRepo::create(&self.db, &link)
    }

    pub fn get_linked_commands(&self, note_id: &str) -> Result<Vec<CommandNoteLinkRow>, String> {
        CommandNoteLinkRepo::list_by_note(&self.db, note_id)
    }

    pub fn get_linked_notes(&self, command_id: &str) -> Result<Vec<CommandNoteLinkRow>, String> {
        CommandNoteLinkRepo::list_by_command(&self.db, command_id)
    }

    pub fn list_groups(&self) -> Result<Vec<NoteGroupRow>, String> {
        NoteGroupRepo::list(&self.db)
    }

    pub fn create_group(&self, name: &str, icon: &str, color: &str, sort_order: i64) -> Result<NoteGroupRow, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let group = NoteGroupRow {
            id: id.clone(),
            name: name.to_string(),
            icon: icon.to_string(),
            color: color.to_string(),
            sort_order,
            created_at: now,
            updated_at: now,
        };
        NoteGroupRepo::save(&self.db, &group)?;
        self.ensure_default_categories_for_group(&id)?;
        Ok(group)
    }

    pub fn update_group(&self, id: &str, name: &str, icon: &str, color: &str, sort_order: i64) -> Result<NoteGroupRow, String> {
        let mut group = NoteGroupRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Group not found".to_string())?;
        group.name = name.to_string();
        group.icon = icon.to_string();
        group.color = color.to_string();
        group.sort_order = sort_order;
        group.updated_at = now_ms();
        NoteGroupRepo::save(&self.db, &group)?;
        Ok(group)
    }

    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        NoteRepo::reset_group(&self.db, id)?;
        NoteCategoryRepo::delete_by_group(&self.db, id)?;
        NoteGroupRepo::delete(&self.db, id)
    }

    pub fn list_categories_by_group(&self, group_id: &str) -> Result<Vec<NoteCategoryRow>, String> {
        NoteCategoryRepo::list_by_group(&self.db, group_id)
    }

    pub fn create_category(&self, name: &str, group_id: &str, sort_order: i64) -> Result<NoteCategoryRow, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let cat = NoteCategoryRow {
            id,
            name: name.to_string(),
            group_id: group_id.to_string(),
            is_default: false,
            sort_order,
            created_at: now,
            updated_at: now,
        };
        NoteCategoryRepo::save(&self.db, &cat)?;
        Ok(cat)
    }

    pub fn update_category(&self, id: &str, name: &str, sort_order: i64) -> Result<NoteCategoryRow, String> {
        let mut cat = NoteCategoryRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Category not found".to_string())?;
        cat.name = name.to_string();
        cat.sort_order = sort_order;
        cat.updated_at = now_ms();
        NoteCategoryRepo::save(&self.db, &cat)?;
        Ok(cat)
    }

    pub fn delete_category(&self, id: &str) -> Result<(), String> {
        let cat = NoteCategoryRepo::get_by_id(&self.db, id)?;
        if let Some(c) = cat {
            NoteRepo::reset_category(&self.db, &c.name)?;
        }
        NoteCategoryRepo::delete(&self.db, id)
    }

    fn format_date(ts: i64) -> String {
        let secs = ts / 1000;
        let days_since_epoch = secs / 86400;
        let date = if days_since_epoch > 0 {
            let mut d = days_since_epoch;
            let year = 1970 + (d / 365);
            d %= 365;
            let month = (d / 30) + 1;
            d %= 30;
            let day = d + 1;
            format!("{:04}-{:02}-{:02}", year, month.min(12), day.min(28))
        } else {
            "1970-01-01".to_string()
        };
        date
    }

    fn slugify(title: &str) -> String {
        title
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-")
    }
}
