#![allow(dead_code)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteFrontMatter {
    pub id: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub linked_commands: Vec<LinkedCommandRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedCommandRef {
    pub id: String,
    pub command: String,
    pub context: String,
}

pub struct NoteFileSystem {
    root_dir: PathBuf,
}

impl NoteFileSystem {
    pub fn new(root_dir: &Path) -> Self {
        NoteFileSystem {
            root_dir: root_dir.to_path_buf(),
        }
    }

    pub fn ensure_dirs(&self) -> io::Result<()> {
        fs::create_dir_all(&self.root_dir)?;
        fs::create_dir_all(self.root_dir.join("uncategorized"))?;
        Ok(())
    }

    pub fn note_path(&self, category: &str, file_name: &str) -> PathBuf {
        self.root_dir.join(category).join(file_name)
    }

    pub fn read_note(&self, file_path: &Path) -> io::Result<(NoteFrontMatter, String)> {
        let content = fs::read_to_string(file_path)?;
        let (front_matter, body) = Self::parse_front_matter(&content)?;
        Ok((front_matter, body))
    }

    pub fn write_note(
        &self,
        file_path: &Path,
        front_matter: &NoteFrontMatter,
        body: &str,
    ) -> io::Result<()> {
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = Self::build_markdown(front_matter, body);
        fs::write(file_path, &content)?;
        Ok(())
    }

    pub fn delete_note(&self, file_path: &Path) -> io::Result<()> {
        if file_path.exists() {
            fs::remove_file(file_path)?;
        }
        Ok(())
    }

    pub fn list_notes(&self, category: &str) -> io::Result<Vec<PathBuf>> {
        let dir = self.root_dir.join(category);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                files.push(path);
            }
        }
        files.sort_by(|a, b| b.cmp(a));
        Ok(files)
    }

    pub fn search_notes(&self, query: &str) -> io::Result<Vec<(PathBuf, NoteFrontMatter)>> {
        let mut results = Vec::new();
        self.search_dir(&self.root_dir, query, &mut results)?;
        results.sort_by(|a, b| b.1.updated_at.cmp(&a.1.updated_at));
        Ok(results)
    }

    fn search_dir(
        &self,
        dir: &Path,
        query: &str,
        results: &mut Vec<(PathBuf, NoteFrontMatter)>,
    ) -> io::Result<()> {
        if !dir.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                self.search_dir(&path, query, results)?;
            } else if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    let query_lower = query.to_lowercase();
                    if content.to_lowercase().contains(&query_lower) {
                        if let Ok((fm, _)) = Self::parse_front_matter(&content) {
                            results.push((path, fm));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn parse_front_matter(content: &str) -> io::Result<(NoteFrontMatter, String)> {
        let content = content.trim();

        if !content.starts_with("---") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "No front matter found",
            ));
        }

        let rest = &content[3..];

        let (yaml_str, body) = if let Some(newline_pos) = rest.find("\n---") {
            let yaml = rest[..newline_pos].trim();
            let body_start = newline_pos + 4;
            let body = if body_start < rest.len() {
                rest[body_start..].trim().to_string()
            } else {
                String::new()
            };
            (yaml, body)
        } else if let Some(pos) = rest.find("---") {
            let yaml = rest[..pos].trim();
            let body_start = pos + 3;
            let body = if body_start < rest.len() {
                rest[body_start..].trim().to_string()
            } else {
                String::new()
            };
            (yaml, body)
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid front matter: no closing ---",
            ));
        };

        if yaml_str.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid front matter: empty yaml",
            ));
        }

        let front_matter: NoteFrontMatter = serde_yaml::from_str(yaml_str)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

        Ok((front_matter, body))
    }

    fn build_markdown(front_matter: &NoteFrontMatter, body: &str) -> String {
        let yaml = serde_yaml::to_string(front_matter).unwrap_or_default();
        format!("---\n{}\n---\n\n{}", yaml.trim(), body.trim())
    }
}
