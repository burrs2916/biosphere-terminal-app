use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{Local, LocalResult, TimeZone};
use serde::{Deserialize, Serialize};

use tauri::{AppHandle, Emitter};

use crate::infra::filesystem::note_fs::{NoteFileSystem, NoteFrontMatter, LinkedCommandRef};
use crate::infra::storage::database::Database;
use crate::infra::storage::note_repo::{NoteRepo, NoteRow, NoteGroupRepo, NoteGroupRow, CommandNoteLinkRepo, CommandNoteLinkRow, NoteCategoryRepo, NoteCategoryRow, NoteTagRepo, NoteTagRow};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 笔记关联的命令，附带"原命令是否仍存在"标记。
/// R6-4：命令历史被删后保留链接（不再级联删），笔记侧据此显示
/// "关联命令已删除"的过期提示，而非静默丢链。
#[derive(Serialize)]
pub struct LinkedCommandWithStatus {
    pub id: String,
    pub command_id: String,
    pub note_id: String,
    pub context: String,
    pub created_at: i64,
    pub command_exists: bool,
}

/// 计算不会覆盖目标目录下已有文件的安全路径：若目标已存在且不是同一文件，
/// 则在文件名中追加笔记 id 去重，避免重归类/改分组时静默覆盖其他笔记文件导致数据丢失。
/// 计算不会覆盖目标目录下已有文件的安全路径：若目标已存在且不是同一文件，
/// 则在文件名中追加笔记 id 去重，避免重归类/改分组时静默覆盖其他笔记文件导致数据丢失。
/// `occupied` 传入"本次批量重归类中已分配的目标路径"，用于批次内防撞——
/// 否则同一分组下两个同名文件在 DB 路径计算阶段（尚无一文件落盘）都会解析到同一目标，
/// 后续写盘时后者静默覆盖前者，造成被覆盖笔记的正文丢失（R26 修复的隐藏缺陷）。
fn disambiguate_target_path(
    target: PathBuf,
    existing: &Path,
    note_id: &str,
    occupied: &std::collections::HashSet<PathBuf>,
) -> PathBuf {
    if (!target.exists() || target == existing) && !occupied.contains(&target) {
        return target;
    }
    let parent = target.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| note_id.to_string());
    let ext = target
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "md".to_string());
    let suffix: String = note_id.chars().take(8).collect();
    let mut candidate = parent.join(format!("{}-{}.{}", stem, suffix, ext));
    let mut i = 1;
    while candidate.exists() || occupied.contains(&candidate) {
        candidate = parent.join(format!("{}-{}-{}.{}", stem, suffix, i, ext));
        i += 1;
    }
    candidate
}

pub struct NotebookService {
    fs: NoteFileSystem,
    pub db: Arc<Database>,
    app_handle: AppHandle,
}

/// 切组时 category 被自动重置的详情（仅在确实发生重置时返回 Some）。
/// 之前 `update_note` 切组时若旧 category 不在新组分类列表，会通过
/// `ensure_category` 在新组"凭空补建"一行非默认分类（is_default=0），
/// 用户切到新组后会看到自己没建过的分类。本结构体改在源头拦截重置行为，
/// 让前端 notify 告知用户「分类 X 在新分组不存在，已重置为 uncategorized」。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryResetInfo {
    pub from: String,
    pub to: String,
    pub target_group: String,
}

impl NotebookService {
    pub fn new(notes_dir: PathBuf, db: Arc<Database>, app_handle: AppHandle) -> Self {
        let fs = NoteFileSystem::new(&notes_dir);
        let _ = fs.ensure_dirs();
        let service = NotebookService { fs, db, app_handle };
        let _ = service.ensure_default_groups();
        let _ = service.ensure_uncategorized_group();
        service
    }

    /// 写操作（增/删/改笔记、关联/解除命令、硬删分组）成功后广播事件，
    /// 让所有前端视图（笔记本列表/编辑器/命令历史关联面板）即时刷新，
    /// 避免"AI 在进程内改了数据但 UI 不刷新"的状态错乱。
    pub(crate) fn notify_notes_changed(&self) {
        let _ = self.app_handle.emit("notes-changed", ());
    }

    pub(crate) fn notify_links_changed(&self) {
        let _ = self.app_handle.emit("note-links-changed", ());
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

    /// 确保始终存在一个兜底分组 `uncategorized`，使"无分组"笔记的 group_id
    /// 指向真实存在的组（避免违反 notes.group_id 外键）。
    fn ensure_uncategorized_group(&self) -> Result<(), String> {
        if NoteGroupRepo::get_by_id(&self.db, "uncategorized")?.is_none() {
            let now = now_ms();
            let group = NoteGroupRow {
                id: "uncategorized".to_string(),
                name: "Uncategorized".to_string(),
                icon: "📁".to_string(),
                color: "#9E9E9E".to_string(),
                sort_order: 99,
                created_at: now,
                updated_at: now,
            };
            NoteGroupRepo::save(&self.db, &group)?;
            self.ensure_default_categories_for_group("uncategorized")?;
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
                    match self.fs.read_note(&file_path) {
                        Ok((_, body)) => Ok(Some((n, body))),
                        // 读文件失败：回退 content 冗余列，避免内容"丢失"（P0-3）
                        Err(_) => Ok(Some((n.clone(), n.content.clone()))),
                    }
                } else {
                    // 文件缺失：用冗余列兜底（P0-3）
                    Ok(Some((n.clone(), n.content.clone())))
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
        // 归一化"无分组"为真实存在的兜底组，避免违反 notes.group_id 外键（P1-1）
        let group_id = if group_id.is_empty() { "uncategorized" } else { group_id };
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();

        let dir_name = group_id;
        let date_str = Self::format_date(now);
        // 文件名用创建日期 + 标题 slug；slug 为空（纯非拉丁字符标题）时回退 "untitled"，
        // 避免出现 "2026-07-24-.md" 这类退化文件名（R5-2）。
        let file_name = format!("{}-{}.md", date_str, Self::file_base_name(title));
        // 同日同名标题会生成相同文件名，先去重避免覆盖已有笔记文件
        let occupied = std::collections::HashSet::new();
        let file_path = disambiguate_target_path(
            self.fs.note_path(dir_name, &file_name),
            Path::new(""),
            &id,
            &occupied,
        );

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

        let word_count = Self::count_words(content);
        let note = NoteRow {
            id,
            title: title.to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            group_id: group_id.to_string(),
            category: category.to_string(),
            tags,
            content: content.to_string(),
            word_count,
            is_pinned: false,
            created_at: now,
            updated_at: now,
        };

        // 保证笔记使用的分类在 note_categories 表中登记（根治双来源：单一真相源）
        self.ensure_category(group_id, category)?;
        NoteRepo::save(&self.db, &note)?;
        self.sync_note_tags(&note.id, group_id, &note.tags)?;
        self.notify_notes_changed();
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
        // 切组时若旧分类不在新组，会在 ensure_category 阶段被静默补建（is_default=0）；
        // 这导致"切到 programming 后凭空出现一个用户没建过的 snippet 分类"。
        // 改用 update_note_with_outcome 拿到 changed_category 标记，前端 notify 告知用户。
        self.update_note_with_outcome(id, title, content, group_id, category, tags)
            .map(|(note, _)| note)
    }

    /// 同 update_note，但额外返回「切组时是否对 category 做了重置」标记。
    /// 旧签名 update_note 仍存在，内部走本方法 → 老调用方零迁移成本。
    pub fn update_note_with_outcome(
        &self,
        id: &str,
        title: &str,
        content: &str,
        group_id: &str,
        category: &str,
        tags: Vec<String>,
    ) -> Result<(NoteRow, Option<CategoryResetInfo>), String> {
        let existing = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;

        // 归一化"无分组"为真实存在的兜底组（P1-1）
        let group_id = if group_id.is_empty() { "uncategorized" } else { group_id };
        let now = now_ms();
        let existing_file = PathBuf::from(&existing.file_path);
        // `occupied` 对本函数无 batch 语义（只处理单条笔记），仅补齐新签名所需入参。
        let occupied = std::collections::HashSet::new();
        // 计算目标文件路径：
        // - 跨分组：保留原文件名，迁移到新分组目录（与 DB group_id 一致）；
        // - 同分组且标题变化：按新标题重新生成 slug 文件名，避免磁盘文件名停在旧标题（P2-2）；
        // - 同分组且标题不变：原地不动。
        let new_file_path = if group_id != existing.group_id {
            let dir_name = group_id;
            let file_name = existing_file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("{}.md", id));
            disambiguate_target_path(self.fs.note_path(dir_name, &file_name), &existing_file, id, &occupied)
        } else if title != existing.title {
            // 保留创建日期作为文件名前缀（与新建一致），避免重命名后文件名日期变成"今天"造成错位（R5-1）。
            let new_name = format!("{}-{}.md", Self::format_date(existing.created_at), Self::file_base_name(title));
            let candidate = self.fs.note_path(&existing.group_id, &new_name);
            if candidate == existing_file {
                existing_file.clone()
            } else {
                disambiguate_target_path(candidate, &existing_file, id, &occupied)
            }
        } else {
            existing_file.clone()
        };

        // ===== 切组 category 校验 =====
        // 切到新组时若旧 category 名字不在新组分类列表里：
        //   - 若 category 非空：强制改为新组的默认 uncategorized 名字，并记录 reset 供前端 notify
        //   - 若 category 本身为空：保持空（=「未分类」）
        //   - 同组内不做此校验（用户可能是改名字还没补登记 → 让 ensure_category 去补）
        // 避免原先 ensure_category 在新组"凭空补建"非默认分类行（用户根本没建过）的脏数据。
        let mut final_category = category.to_string();
        let mut category_reset: Option<CategoryResetInfo> = None;
        if group_id != existing.group_id && !category.is_empty() {
            let target_exists = NoteCategoryRepo::find_by_group_and_name(&self.db, group_id, category)?.is_some();
            if !target_exists {
                let old = category.to_string();
                // 新组默认 5 个：uncategorized / snippet / note / tutorial / reference；
                // uncategorized 必然存在（ensure_uncategorized_group + ensure_default_categories_for_group 保证）。
                final_category = "uncategorized".to_string();
                category_reset = Some(CategoryResetInfo {
                    from: old,
                    to: final_category.clone(),
                    target_group: group_id.to_string(),
                });
            }
        }

        let links = CommandNoteLinkRepo::list_by_note(&self.db, id)?;
        let linked_commands: Vec<LinkedCommandRef> = links
            .iter()
            .map(|l| LinkedCommandRef {
                id: l.command_id.clone(),
                // 回填空命令文本（context 即链接时记录的命令文本），让 .md 文件自描述，
                // 直接打开文件也能看到关联的是哪条命令（R4 pending #4 的轻量落地）。
                command: l.context.clone(),
                context: l.context.clone(),
            })
            .collect();

        let front_matter = NoteFrontMatter {
            id: id.to_string(),
            title: title.to_string(),
            category: final_category.clone(),
            tags: tags.clone(),
            created_at: existing.created_at,
            updated_at: now,
            linked_commands,
        };

        let word_count = Self::count_words(content);
        let note = NoteRow {
            id: id.to_string(),
            title: title.to_string(),
            file_path: new_file_path.to_string_lossy().to_string(),
            group_id: group_id.to_string(),
            category: final_category.clone(),
            tags,
            content: content.to_string(),
            word_count,
            is_pinned: existing.is_pinned,
            created_at: existing.created_at,
            updated_at: now,
        };

        // 先写 DB（真相源）：失败则文件不动，原文件与旧 DB 路径一致，无数据丢失（P0-2）
        // 用 final_category（可能已被重置），确保新组分类表里有这一行。
        self.ensure_category(group_id, &final_category)?;
        NoteRepo::save(&self.db, &note)?;
        self.sync_note_tags(&note.id, group_id, &note.tags)?;

        // DB 提交成功后迁移文件；FS 失败不致命：旧文件仍在，get_note 用 content 兜底（P0-3）
        self.fs.write_note(&new_file_path, &front_matter, content)
            .map_err(|e| e.to_string())?;
        if new_file_path != existing_file {
            if let Err(e) = self.fs.delete_note(&existing_file) {
                eprintln!("[notebook] failed to delete old note file {:?}: {}", existing_file, e);
            }
        }
        self.notify_notes_changed();
        Ok((note, category_reset))
    }

    pub fn delete_note(&self, id: &str) -> Result<(), String> {
        let note = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;

        // 先 DB 清理（含命令/标签链接级联），再删文件；DB 失败则文件不删，避免孤儿文件指向已删 DB 行（P1-2）
        NoteRepo::delete(&self.db, id)?;
        let file_path = PathBuf::from(&note.file_path);
        if let Err(e) = self.fs.delete_note(&file_path) {
            eprintln!("[notebook] failed to delete note file {:?}: {}", file_path, e);
        }
        self.notify_notes_changed();
        Ok(())
    }

    pub fn toggle_pin(&self, id: &str) -> Result<NoteRow, String> {
        let mut note = NoteRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Note not found".to_string())?;
        note.is_pinned = !note.is_pinned;
        note.updated_at = now_ms();
        NoteRepo::save(&self.db, &note)?;
        self.notify_notes_changed();
        Ok(note)
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<NoteRow>, String> {
        let q = if query.trim().is_empty() { None } else { Some(query.trim()) };
        NoteRepo::list(&self.db, None, None, q)
    }

    pub fn list_categories(&self) -> Result<Vec<String>, String> {
        NoteRepo::list_categories(&self.db)
    }

    pub fn link_command(&self, note_id: &str, command_id: &str, context: &str) -> Result<(), String> {
        // 去重：同一 (note_id, command_id) 只保留一行，避免重复关联导致关联分裂（P2-6）
        let existing = CommandNoteLinkRepo::list_by_note(&self.db, note_id)?;
        if let Some(mut link) = existing.into_iter().find(|l| l.command_id == command_id) {
            // 已关联：仅更新 context（保留创建时间），不新增重复行
            link.context = context.to_string();
            CommandNoteLinkRepo::update(&self.db, &link)?;
            self.notify_links_changed();
            return Ok(());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let link = CommandNoteLinkRow {
            id,
            command_id: command_id.to_string(),
            note_id: note_id.to_string(),
            context: context.to_string(),
            created_at: now_ms(),
        };
        CommandNoteLinkRepo::create(&self.db, &link)?;
        self.notify_links_changed();
        Ok(())
    }

    /// 返回某笔记关联的所有命令，并标记每条链接的原命令是否仍然存在。
    /// 命令历史条目被删除后，链接不再级联删除（R6-4），因此这里用 EXISTS 子查询
    /// 实时判断 command_history 中是否还有对应的原命令。
    pub fn get_linked_commands(&self, note_id: &str) -> Result<Vec<LinkedCommandWithStatus>, String> {
        let conn = self.db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT cnl.id, cnl.command_id, cnl.note_id, cnl.context, cnl.created_at, \
                 EXISTS(SELECT 1 FROM command_history ch WHERE ch.id = cnl.command_id) AS command_exists \
                 FROM command_note_links cnl WHERE cnl.note_id = ?1 ORDER BY cnl.created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![note_id], |row| {
                Ok(LinkedCommandWithStatus {
                    id: row.get(0)?,
                    command_id: row.get(1)?,
                    note_id: row.get(2)?,
                    context: row.get(3)?,
                    created_at: row.get(4)?,
                    command_exists: row.get::<_, i64>(5)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
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
        // 改名/换色后，GroupSidebar/CategoryCards 等需重新拉取（之前的实现缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(group)
    }

    /// 删除分组：默认「重归类」语义——把分组下所有笔记及文件移动到目标分组，
    /// 而非硬销毁。仅当 delete_notes=true 时才硬删除（兜底逃生口）。
    pub fn delete_group(
        &self,
        id: &str,
        target_group_id: Option<String>,
        delete_notes: bool,
    ) -> Result<(), String> {
        // 系统默认兜底分组「未分类」不可删：notes.group_id 对其有
        // `FOREIGN KEY ... ON DELETE CASCADE`。若允许删除，重归类分支会把笔记重新归类到
        // 同一个 uncategorized（自身），随后删除该组行会级联删除所有这些笔记，造成数据丢失；
        // 且删除后新建的"无分组"笔记因 group_id 指向已不存在的组而违反外键约束。
        if id == "uncategorized" {
            return Err("默认分组「未分类」不可删除".to_string());
        }

        let notes = NoteRepo::list_by_group(&self.db, id)?;

        if delete_notes {
            // 硬删除（兜底逃生口）：先 DB 清理，再删文件（FS 失败不致命）
            let mut conn = self.db.conn();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            NoteRepo::delete_by_group_conn(&tx, id)?;
            NoteCategoryRepo::delete_by_group_conn(&tx, id)?;
            NoteTagRepo::delete_by_group_conn(&tx, id)?;
            NoteGroupRepo::delete_conn(&tx, id)?;
            tx.commit().map_err(|e| e.to_string())?;
            for note in &notes {
                if let Err(e) = self.fs.delete_note(&PathBuf::from(&note.file_path)) {
                    eprintln!("[notebook] failed to delete note file {:?}: {}", note.file_path, e);
                }
            }
            self.notify_notes_changed();
            return Ok(());
        }

        if notes.is_empty() {
            // 空分组：无需重归类，直接删除其分类/标签孤儿行 + 分组行
            let mut conn = self.db.conn();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            NoteCategoryRepo::delete_by_group_conn(&tx, id)?;
            NoteTagRepo::delete_by_group_conn(&tx, id)?;
            NoteGroupRepo::delete_conn(&tx, id)?;
            tx.commit().map_err(|e| e.to_string())?;
            self.notify_notes_changed();
            return Ok(());
        }

        // 重归类：把笔记迁移到目标分组（必须存在且不是自身；空串兜底到 uncategorized 兜底组）
        let target_id = target_group_id
            .clone()
            .filter(|t| t != id && !t.is_empty())
            .unwrap_or_else(|| "uncategorized".to_string());
        NoteGroupRepo::get_by_id(&self.db, &target_id)?
            .ok_or_else(|| "目标分组不存在".to_string())?;

        // 先 DB 全部更新（新 group_id/file_path/content），再删旧组孤儿行；
        // FS 在 DB 提交后做，失败不致命（content 兜底 + 旧文件残留，不丢内容）
        let mut migrations: Vec<(PathBuf, PathBuf, NoteFrontMatter, String)> = Vec::new();
        // `occupied` 累积"本批次已分配的目标路径"，用于批次内防撞：
        // 同组下多个同名笔记在 DB 路径计算阶段（尚无一文件落盘）都会解析到同一目标，
        // 若不在循环内累积已分配路径，后者会静默覆盖前者，造成被覆盖笔记正文丢失（R26 修复）。
        let mut occupied = std::collections::HashSet::new();
        for note in &notes {
            let existing_file = PathBuf::from(&note.file_path);
            let dir_name = if target_id.is_empty() { "uncategorized" } else { &target_id };
            let file_name = existing_file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("{}.md", note.id));
            let new_file_path = disambiguate_target_path(
                self.fs.note_path(dir_name, &file_name),
                &existing_file,
                &note.id,
                &occupied,
            );
            // 把本次分配的目标路径登记进 occupied，下一条笔记的路径计算会跳过它，避免批次内覆盖。
            occupied.insert(new_file_path.clone());
            // 读取现有正文与 front matter；文件缺失则用 DB 冗余列重建
            let (front_matter, body) = if existing_file.exists() {
                self.fs.read_note(&existing_file).map_err(|e| e.to_string())?
            } else {
                // 文件缺失时从 DB 重建 front matter，并补全关联命令（避免迁移后
                // .md 文件的 linked_commands 丢失，导致文件自描述信息不完整）。
                let links = CommandNoteLinkRepo::list_by_note(&self.db, &note.id)?;
                let linked_commands: Vec<LinkedCommandRef> = links
                    .iter()
                    .map(|l| LinkedCommandRef {
                        id: l.command_id.clone(),
                        command: l.context.clone(),
                        context: l.context.clone(),
                    })
                    .collect();
                (
                    NoteFrontMatter {
                        id: note.id.clone(),
                        title: note.title.clone(),
                        category: note.category.clone(),
                        tags: note.tags.clone(),
                        created_at: note.created_at,
                        updated_at: note.updated_at,
                        linked_commands,
                    },
                    note.content.clone(),
                )
            };
            let mut updated = note.clone();
            updated.group_id = target_id.clone();
            updated.file_path = new_file_path.to_string_lossy().to_string();
            updated.content = body.clone(); // 与文件正文保持一致（P1-4）
            updated.updated_at = now_ms();
            // 目标分组登记该笔记使用的分类，避免重归类后分类在目标组"消失"
            // （此前依赖 list_categories_by_group 的自愈逻辑，存在间隙）（R5-4）。
            self.ensure_category(&target_id, &updated.category)?;
            NoteRepo::save(&self.db, &updated)?;
            self.sync_note_tags(&note.id, &target_id, &note.tags)?;
            migrations.push((existing_file, new_file_path, front_matter, body));
        }

        // 旧分组的分类/标签行已随笔记迁走，删除孤儿行 + 分组本身
        let mut conn = self.db.conn();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        NoteCategoryRepo::delete_by_group_conn(&tx, id)?;
        NoteTagRepo::delete_by_group_conn(&tx, id)?;
        NoteGroupRepo::delete_conn(&tx, id)?;
        tx.commit().map_err(|e| e.to_string())?;

        // DB 提交后迁移文件（FS 失败不致命：content 兜底 + 旧文件残留）
        for (old_file, new_file, front_matter, body) in &migrations {
            if new_file != old_file {
                if let Err(e) = self.fs.write_note(new_file, front_matter, body) {
                    eprintln!("[notebook] reclassify FS write failed for {:?}: {}", new_file, e);
                } else if let Err(e) = self.fs.delete_note(old_file) {
                    eprintln!("[notebook] reclassify FS delete failed for {:?}: {}", old_file, e);
                }
            }
        }
        self.notify_notes_changed();
        Ok(())
    }

    pub fn list_categories_by_group(&self, group_id: &str) -> Result<Vec<NoteCategoryRow>, String> {
        // 根治"分类双来源"：把所有笔记实际用到的分类登记进 note_categories 表，
        // 消灭无法重命名/删除的 auto- 幽灵分类，使 note_categories 成为唯一真相源。
        // 幂等：已登记过的分类跳过，不会重复建行。
        let actual_categories = NoteRepo::list_categories_by_group(&self.db, group_id)?;
        for cat_name in actual_categories {
            self.ensure_category(group_id, &cat_name)?;
        }
        let mut cats = NoteCategoryRepo::list_by_group(&self.db, group_id)?;
        // 按 name 去重（极低概率并发重复写入的兜底，避免 UI 出现重复分类卡片）
        cats.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.name.cmp(&b.name)));
        cats.dedup_by_key(|c| c.name.clone());
        Ok(cats)
    }

    /// 幂等地确保 (group_id, name) 在 note_categories 表中存在一行。
    /// 用于：笔记被赋予某个分类时自动登记，避免产生表里没有的"幽灵分类"。
    fn ensure_category(&self, group_id: &str, name: &str) -> Result<(), String> {
        if name.is_empty() || group_id.is_empty() {
            return Ok(());
        }
        let existing = NoteCategoryRepo::find_by_group_and_name(&self.db, group_id, name)?;
        if existing.is_none() {
            let id = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            let cat = NoteCategoryRow {
                id,
                name: name.to_string(),
                group_id: group_id.to_string(),
                is_default: false,
                sort_order: 999,
                created_at: now,
                updated_at: now,
            };
            NoteCategoryRepo::save(&self.db, &cat)?;
        }
        Ok(())
    }

    // ----- 标签一等公民 -----

    /// 幂等地确保 (group_id, name) 在 note_tags 表中存在一行（标签库按组隔离）。
    fn ensure_tag(&self, group_id: &str, name: &str) -> Result<(), String> {
        if name.trim().is_empty() || group_id.trim().is_empty() {
            return Ok(());
        }
        if NoteTagRepo::find_by_group_and_name(&self.db, group_id, name)?.is_none() {
            let id = uuid::Uuid::new_v4().to_string();
            let now = now_ms();
            let tag = NoteTagRow {
                id,
                name: name.to_string(),
                group_id: group_id.to_string(),
                sort_order: 999,
                created_at: now,
                updated_at: now,
            };
            NoteTagRepo::save(&self.db, &tag)?;
        }
        Ok(())
    }

    /// 维护某笔记的标签关联：先清旧关联，再按 tags 列表重建（ensure 标签库行 + 建 link）。
    fn sync_note_tags(&self, note_id: &str, group_id: &str, tags: &[String]) -> Result<(), String> {
        NoteTagRepo::unlink_all_for_note(&self.db, note_id)?;
        for tag in tags {
            if tag.trim().is_empty() || group_id.trim().is_empty() {
                continue;
            }
            self.ensure_tag(group_id, tag)?;
            if let Some(row) = NoteTagRepo::find_by_group_and_name(&self.db, group_id, tag)? {
                NoteTagRepo::link_note_tag(&self.db, note_id, &row.id)?;
            }
        }
        Ok(())
    }

    /// 列出某组的标签库（单一真相源）。
    /// 先对该组所有笔记实际用到的标签跑 ensure + link 对账，再纯读 note_tags，避免幽灵标签。
    pub fn list_tags_by_group(&self, group_id: &str) -> Result<Vec<NoteTagRow>, String> {
        let notes = NoteRepo::list_by_group(&self.db, group_id)?;
        for note in &notes {
            for tag in &note.tags {
                if !tag.trim().is_empty() {
                    self.ensure_tag(group_id, tag)?;
                    if let Some(row) = NoteTagRepo::find_by_group_and_name(&self.db, group_id, tag)? {
                        NoteTagRepo::link_note_tag(&self.db, &note.id, &row.id)?;
                    }
                }
            }
        }
        let mut tags = NoteTagRepo::list_by_group(&self.db, group_id)?;
        tags.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.name.cmp(&b.name)));
        tags.dedup_by_key(|t| t.name.clone());
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, group_id: &str, sort_order: i64) -> Result<NoteTagRow, String> {
        // 幂等：同组内已存在同名标签时直接返回既有行，避免产生重复名标签
        // （重复名会导致标签卡片重复、与「单一真相源」目标相悖，R21 修复）。
        if let Some(existing) = NoteTagRepo::find_by_group_and_name(&self.db, group_id, name)? {
            return Ok(existing);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let tag = NoteTagRow {
            id,
            name: name.to_string(),
            group_id: group_id.to_string(),
            sort_order,
            created_at: now,
            updated_at: now,
        };
        NoteTagRepo::save(&self.db, &tag)?;
        // 新建标签后，NoteList/NotesReferencePage 标签过滤需重建（之前缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(tag)
    }

    /// 重命名/排序标签：事务内更新 note_tags，并同步该组所有含旧名笔记的冗余 tags 列（含 front_matter 刷新）。
    pub fn update_tag(&self, id: &str, name: &str, sort_order: i64) -> Result<NoteTagRow, String> {
        let mut tag = NoteTagRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Tag not found".to_string())?;
        let old_name = tag.name.clone();
        tag.name = name.to_string();
        tag.sort_order = sort_order;
        tag.updated_at = now_ms();
        let new_name = tag.name.clone();
        // 重命名冲突防护：同组内新名称已被另一条标签占用时拒绝，避免产生重复名标签（R21 修复）。
        if old_name != tag.name {
            if let Some(other) = NoteTagRepo::find_by_group_and_name(&self.db, &tag.group_id, &tag.name)? {
                if other.id != tag.id {
                    return Err(format!("Tag name '{}' already exists in this group", tag.name));
                }
            }
        }
        // 事务内：先重命名标签库行，再对同组 notes.tags 做旧名→新名替换，并收集受影响文件的路径。
        // 受影响路径必须在事务内（提交前）收集——提交后 notes.tags 已是新名，再按旧名过滤必然为空，
        // 导致 .md 文件 front matter 永远不被回写（R21 修复：此前 update_tag 的文件回写是死代码）。
        // 事务限制在独立块内，提交后释放锁再做文件回写（避免 db.conn() 死锁）。
        let affected_paths: Vec<PathBuf> = {
            let mut conn = self.db.conn();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            NoteTagRepo::save_conn(&tx, &tag)?;
            let mut paths = Vec::new();
            if old_name != tag.name {
                let notes = NoteRepo::list_by_group_conn(&tx, &tag.group_id)?;
                for mut note in notes {
                    if note.tags.iter().any(|t| t == &old_name) {
                        note.tags = note
                            .tags
                            .iter()
                            .map(|t| if t == &old_name { name.to_string() } else { t.clone() })
                            .collect();
                        NoteRepo::save_conn(&tx, &note)?;
                        paths.push(PathBuf::from(&note.file_path));
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
            paths
        };
        // 同步回写 .md 文件 front matter 的 tags，避免磁盘与 DB 长期漂移（双真相源对齐）。
        for fp in &affected_paths {
            let old_name = old_name.clone();
            let new_name = new_name.clone();
            self.patch_note_file_front_matter(fp, |fm, _body| {
                for tg in fm.tags.iter_mut() {
                    if *tg == old_name {
                        *tg = new_name.clone();
                    }
                }
            });
        }
        // 改名后，NoteList/NotesReferencePage 标签过滤需重建（之前缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(tag)
    }

    /// 删除标签（按组生效）：先同步移除该组笔记冗余 tags 列中的该标签，再删标签库行（级联删关联）。
    pub fn delete_tag(&self, id: &str) -> Result<(), String> {
        let tag = NoteTagRepo::get_by_id(&self.db, id)?;
        if let Some(t) = tag {
            let deleted_name = t.name.clone();
            let group_id = t.group_id.clone();
            // 事务内：移除同组笔记冗余 tags 列中的该标签，再删标签库行（级联删关联）。
            // 事务限制在独立块内，提交后释放锁再做文件回写（避免 db.conn() 死锁）。
            let affected_paths: Vec<PathBuf> = {
                let mut conn = self.db.conn();
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                let notes = NoteRepo::list_by_group_conn(&tx, &group_id)?;
                let mut paths = Vec::new();
                for mut note in notes {
                    if note.tags.iter().any(|x| x == &deleted_name) {
                        note.tags = note.tags.into_iter().filter(|x| x != &deleted_name).collect();
                        NoteRepo::save_conn(&tx, &note)?;
                        paths.push(PathBuf::from(&note.file_path));
                    }
                }
                NoteTagRepo::delete_conn(&tx, id)?;
                tx.commit().map_err(|e| e.to_string())?;
                paths
            };
            // 同步回写 .md 文件 front matter，移除被删标签，避免磁盘与 DB 漂移。
            for fp in &affected_paths {
                let deleted_name = deleted_name.clone();
                self.patch_note_file_front_matter(fp, |fm, _body| {
                    fm.tags.retain(|tg| tg != &deleted_name);
                });
            }
        }
        // 删标签后，NoteList/NotesReferencePage 标签过滤需重建（之前缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(())
    }

    pub fn create_category(&self, name: &str, group_id: &str, sort_order: i64) -> Result<NoteCategoryRow, String> {
        // 幂等：同组内已存在同名分类时直接返回既有行，避免产生重复名分类
        // （重复名会导致分类卡片重复、与「单一真相源」目标相悖，R21 修复）。
        if let Some(existing) = NoteCategoryRepo::find_by_group_and_name(&self.db, group_id, name)? {
            return Ok(existing);
        }
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
        // 新建分类后，CategoryCards/NoteList 分类过滤需重建（之前缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(cat)
    }

    pub fn update_category(&self, id: &str, name: &str, sort_order: i64) -> Result<NoteCategoryRow, String> {
        let mut cat = NoteCategoryRepo::get_by_id(&self.db, id)?
            .ok_or_else(|| "Category not found".to_string())?;
        let old_name = cat.name.clone();
        cat.name = name.to_string();
        cat.sort_order = sort_order;
        cat.updated_at = now_ms();
        let new_name = cat.name.clone();
        let group_id = cat.group_id.clone();
        // 重命名冲突防护：同组内新名称已被另一条分类占用时拒绝，避免产生重复名分类（R21 修复）。
        if old_name != cat.name {
            if let Some(other) = NoteCategoryRepo::find_by_group_and_name(&self.db, &cat.group_id, &cat.name)? {
                if other.id != cat.id {
                    return Err(format!("Category name '{}' already exists in this group", cat.name));
                }
            }
        }
        // 事务内：先存新分类名，再对同组 notes.category 做旧名→新名重归类，
        // 避免"分类双来源"脱钩（重命名后分类计数 0、笔记归属错乱）。
        // 注意：事务持有 &mut Connection，内部必须用 _conn 变体，否则再次 db.conn() 会死锁；
        // 故把事务限制在独立块内，提交后释放锁再做文件回写（避免死锁）。
        {
            let mut conn = self.db.conn();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            NoteCategoryRepo::save_conn(&tx, &cat)?;
            if old_name != cat.name {
                NoteRepo::reassign_category_conn(&tx, &cat.group_id, &old_name, &cat.name)?;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        // 同步回写 .md 文件 front matter 的 category，避免磁盘与 DB 长期漂移（双真相源对齐）。
        if old_name != new_name {
            let notes = NoteRepo::list_by_group_category(&self.db, &group_id, &new_name)?;
            for note in &notes {
                let fp = PathBuf::from(&note.file_path);
                self.patch_note_file_front_matter(&fp, |fm, _body| {
                    fm.category = new_name.clone();
                });
            }
        }
        // 改名后，CategoryCards/NoteList 分类过滤需重建（之前缺少广播，UI 不刷新）（R5-5）
        self.notify_notes_changed();
        Ok(cat)
    }

    /// 删除分类：仅在该分类所属分组内生效（不再跨组误删）。
    /// 语义为"重归类"——把该组该分类下的笔记改为 uncategorized，
    /// 不删除笔记、不删文件，避免脏数据与误删；整组操作在事务中完成。
    pub fn delete_category(&self, id: &str) -> Result<(), String> {
        let cat = NoteCategoryRepo::get_by_id(&self.db, id)?;
        if let Some(c) = cat {
            // 先事务内做 DB 重归类（不持锁做 FS I/O，P2-4）
            let mut conn = self.db.conn();
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            NoteRepo::reassign_category_conn(&tx, &c.group_id, &c.name, "")?;
            NoteCategoryRepo::delete_conn(&tx, id)?;
            tx.commit().map_err(|e| e.to_string())?;
            // 事务外更新文件 front matter（释放 DB 锁，避免阻塞其他命令）。
            // 注意：reassign_category_conn 把受影响笔记重归类到空串 `""`（与前端「未分类」=空串语义一致，
            // 见 R19 FIX-N2），故此处必须按 `""` 查询，而非字面量 "uncategorized"——
            // 否则查不到任何笔记，.md 的 category front matter 永不更新（R21 修复：磁盘/DB 漂移）。
            let notes = NoteRepo::list_by_group_category(&self.db, &c.group_id, "")?;
            for note in &notes {
                let file_path = PathBuf::from(&note.file_path);
                if file_path.exists() {
                    if let Ok((mut fm, body)) = self.fs.read_note(&file_path) {
                        fm.category = String::new();
                        fm.updated_at = now_ms();
                        if let Err(e) = self.fs.write_note(&file_path, &fm, &body) {
                            eprintln!("[notebook] failed to rewrite note front matter {:?}: {}", file_path, e);
                        }
                    }
                }
            }
        }
        self.notify_notes_changed();
        Ok(())
    }

    /// 原地改写某笔记 .md 文件的 front matter（不动正文），用于分类/标签重命名或删除后
    /// 回写文件，避免磁盘 front matter 与 DB 长期漂移（双真相源对齐）。
    /// 文件不存在时静默跳过（正文以 DB content 冗余列为准，P0-3 兜底）。
    fn patch_note_file_front_matter<F>(&self, file_path: &Path, patch: F)
    where
        F: FnOnce(&mut NoteFrontMatter, &mut String),
    {
        if !file_path.exists() {
            return;
        }
        if let Ok((mut fm, mut body)) = self.fs.read_note(file_path) {
            patch(&mut fm, &mut body);
            fm.updated_at = now_ms();
            if let Err(e) = self.fs.write_note(file_path, &fm, &body) {
                eprintln!("[notebook] patch front matter failed {:?}: {}", file_path, e);
            }
        }
    }

    fn format_date(ts: i64) -> String {
        let secs = ts / 1000;
        // 用本地时区而非 UTC：避免"本地 23:30 创建、文件名却显示次日 UTC 日期"的 ±1 天错位（中文用户本地时间更直觉）。
        match Local.timestamp_opt(secs, 0) {
            LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
            _ => "1970-01-01".to_string(),
        }
    }

    /// 字数统计：中文/日文/韩文按字符计（每个 CJK 字符算 1 词），拉丁字母按空白分隔的词计。
    /// 替代原先的 `split_whitespace().count()`——该方式对中文笔记恒为 0，导致字数展示失真。
    fn count_words(content: &str) -> i64 {
        let mut count: i64 = 0;
        let mut latin_run = false;
        for ch in content.chars() {
            let cp = ch as u32;
            let is_cjk = (0x3400..=0x4DBF).contains(&cp)
                || (0x4E00..=0x9FFF).contains(&cp) // CJK 统一表意文字
                || (0x3005..=0x3007).contains(&cp) // 々 〇 等
                || (0xAC00..=0xD7A3).contains(&cp) // 谚文音节
                || (0x3040..=0x30FF).contains(&cp) // 平假名/片假名
                || (0xF900..=0xFAFF).contains(&cp); // CJK 兼容表意文字
            if is_cjk {
                count += 1;
                latin_run = false;
            } else if ch.is_alphanumeric() {
                if !latin_run {
                    count += 1;
                    latin_run = true;
                }
            } else {
                latin_run = false;
            }
        }
        count
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

    /// 生成笔记文件名（不含扩展名）：基于标题 slug；
    /// 标题 slug 为空（如纯非拉丁字符标题，slugify 后为空串）时回退 `"untitled"`，
    /// 避免出现 `2026-07-24-.md` 这类退化文件名（R5-2）。
    fn file_base_name(title: &str) -> String {
        let slug = Self::slugify(title);
        if slug.is_empty() {
            "untitled".to_string()
        } else {
            slug
        }
    }
}
