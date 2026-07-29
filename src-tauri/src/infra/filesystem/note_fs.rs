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
        // 原子写：先写同目录临时文件再 rename，避免写过程中崩溃/被中断导致 .md 文件
        // 半截或 0 字节（损坏后只能靠 DB content 冗余列兜底，文件本身要等下次保存才修复）。
        // 临时文件与正式文件同目录，rename 在同卷内是原子的。
        let tmp_path = file_path.with_extension("md.tmp");
        fs::write(&tmp_path, &content)?;
        if let Err(e) = fs::rename(&tmp_path, file_path) {
            // rename 失败（极少见）：清理临时文件，避免残留；并把原错误向上抛
            let _ = fs::remove_file(&tmp_path);
            return Err(e);
        }
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

    fn parse_front_matter(content: &str) -> io::Result<(NoteFrontMatter, String)> {
        // 仅去掉「开头」空白，保留正文末尾的空白（用户有意保留的尾部空行/缩进）。
        // 此前用 content.trim() 会在每次读回时静默抹平正文尾部空白，与 build_markdown
        // 的「保留正文原貌」目标相悖，属于 R14 正文保真修复的残留泄漏点。
        let content = content.trim_start();

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
                Self::strip_one_leading_newline(&rest[body_start..]).to_string()
            } else {
                String::new()
            };
            (yaml, body)
        } else if let Some(pos) = rest.find("---") {
            let yaml = rest[..pos].trim();
            let body_start = pos + 3;
            let body = if body_start < rest.len() {
                Self::strip_one_leading_newline(&rest[body_start..]).to_string()
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

    /// 去掉 build_markdown 写入时加在 front matter 与正文之间的单个分隔空行，
    /// 其余前导/尾部空白原样保留。与 build_markdown 对应，保证 round-trip 幂等且不丢内容。
    fn strip_one_leading_newline(s: &str) -> &str {
        if s.starts_with('\n') {
            &s[1..]
        } else {
            s
        }
    }

    fn build_markdown(front_matter: &NoteFrontMatter, body: &str) -> String {
        let yaml = serde_yaml::to_string(front_matter).unwrap_or_default();
        // 保留正文原貌：不对 body 做 .trim()。
        // 关键：front matter 与正文之间只用「单个换行」分隔（不是空行 `\n\n`）。
        // 因为 parse_front_matter 的 strip_one_leading_newline 只剥「一个」前导换行——
        // 若这里用空行分隔，每轮保存 parse 只剥一个、剩下一个，正文前导空行会逐次累积
        // （R14 正文保真修复引入的回归：每次保存笔记正文悄悄多一个空行，文件逐渐膨胀、
        // 编辑器重开后顶部出现多余空行）。单换行分隔下 round-trip 幂等，不丢也不增内容。
        format!("---\n{}\n---\n{}", yaml.trim(), body)
    }
}
