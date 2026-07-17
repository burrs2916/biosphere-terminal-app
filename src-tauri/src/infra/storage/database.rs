use crate::core::error::Error;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> crate::core::error::Result<Self> {
        tracing::info!("[Database::open] opening database at: {:?}", path);

        // Make sure the parent directory exists. Production app_data_dir
        // typically exists, but be defensive when paths contain Unicode/spaces.
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(
                    "[Database::open] could not create parent dir {:?}: {}",
                    parent,
                    e
                );
            } else {
                // MSIX 沙盒下，即便 create_dir_all 报"已存在成功"，SQLite
                // 之后创建 -journal / -shm 文件时仍可能被 Package Framework
                // 拦住。做一次显式写探测，如果失败就把根因写进日志——
                // 后续 Connection::open 那个 disk I/O error 就有上下文了。
                let probe = parent.join(".biosphere-write-probe");
                match std::fs::write(&probe, b"ok") {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&probe);
                        tracing::info!(
                            "[Database::open] parent dir is writable: {:?}",
                            parent
                        );
                    }
                    Err(e) => {
                        tracing::error!(
                            "[Database::open] parent dir NOT writable ({:?}): {} \
                            — SQLite will very likely fail with disk I/O error next.",
                            parent,
                            e
                        );
                    }
                }
            }
        }

        let conn = Connection::open(path).map_err(|e| {
            // 尽量把 SQLite 的原始 code / extended code 都打出来，方便
            // 区分 SQLITE_CANTOPEN / SQLITE_IOERR / SQLITE_READONLY 等。
            let (primary, extended) = match &e {
                rusqlite::Error::SqliteFailure(err, _) => {
                    (err.code as i32, err.extended_code)
                }
                _ => (-1, -1),
            };
            tracing::error!(
                "[Database::open] sqlite open failed (path={:?}, exists={}, primary={}, extended={}): {}",
                path,
                path.exists(),
                primary,
                extended,
                e
            );
            e
        })?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.initialize()?;
        db.migrate()?;
        tracing::info!("[Database::open] database opened and migrated successfully");
        Ok(db)
    }

    fn initialize(&self) -> crate::core::error::Result<()> {
        let conn = self.conn.lock().map_err(|e| Error::Internal(format!("DB lock poisoned: {}", e)))?;

        // Enable foreign key enforcement (SQLite disables by default)
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        // Try WAL for better concurrent read performance. On MSIX-sandboxed
        // paths WAL sometimes cannot create the -shm shared-memory file
        // (Package Framework blocks it); if WAL fails we silently fall back
        // to DELETE journal mode so the app still starts.
        match conn.execute_batch("PRAGMA journal_mode = WAL;") {
            Ok(_) => tracing::info!("[Database::init] journal_mode=WAL enabled"),
            Err(e) => {
                tracing::warn!(
                    "[Database::init] WAL not available ({}); falling back to DELETE journal",
                    e
                );
                // DELETE is the SQLite default; explicit set to make behaviour clear.
                let _ = conn.execute_batch("PRAGMA journal_mode = DELETE;");
            }
        }
        // Set busy timeout to avoid "database is locked" under contention
        let _ = conn.execute_batch("PRAGMA busy_timeout = 5000;");

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                profile_id TEXT,
                cwd TEXT NOT NULL DEFAULT '/',
                layout_json TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS command_history (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                command TEXT NOT NULL,
                cwd TEXT NOT NULL DEFAULT '/',
                exit_code INTEGER,
                output_snippet TEXT DEFAULT '',
                executed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                command TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                config_json TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                connection_type TEXT NOT NULL,
                config_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'uncategorized',
                tags TEXT NOT NULL DEFAULT '[]',
                word_count INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS note_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '📁',
                color TEXT NOT NULL DEFAULT '#6C63FF',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
            CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned);

            CREATE TABLE IF NOT EXISTS command_note_links (
                id TEXT PRIMARY KEY,
                command_id TEXT NOT NULL,
                note_id TEXT NOT NULL,
                context TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_cnl_command ON command_note_links(command_id);
            CREATE INDEX IF NOT EXISTS idx_cnl_note ON command_note_links(note_id);

            CREATE TABLE IF NOT EXISTS ai_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                api_key TEXT NOT NULL DEFAULT '',
                base_url TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_endpoints (
                id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                name TEXT NOT NULL,
                api_type TEXT NOT NULL DEFAULT 'openai-completions',
                base_url TEXT NOT NULL DEFAULT '',
                auth_type TEXT NOT NULL DEFAULT 'bearer',
                custom_auth_header TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ai_endpoints_provider ON ai_endpoints(provider_id);

            CREATE TABLE IF NOT EXISTS ai_models (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                ref_key TEXT NOT NULL,
                provider_id TEXT NOT NULL DEFAULT '',
                context_window INTEGER NOT NULL DEFAULT 128000,
                max_tokens INTEGER NOT NULL DEFAULT 4096,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                model_id TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL DEFAULT '',
                temperature REAL NOT NULL DEFAULT 0.7,
                max_iterations INTEGER NOT NULL DEFAULT 10,
                tool_ids TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (model_id) REFERENCES ai_models(id)
            );

            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ai_conv_agent ON ai_conversations(agent_id);
            CREATE INDEX IF NOT EXISTS idx_ai_conv_updated ON ai_conversations(updated_at DESC);

            CREATE TABLE IF NOT EXISTS ai_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);

            CREATE TABLE IF NOT EXISTS icon_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS custom_icons (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'svg',
                group_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES icon_groups(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_custom_icons_group ON custom_icons(group_id);

            CREATE TABLE IF NOT EXISTS note_categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                group_id TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES note_groups(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_note_categories_group ON note_categories(group_id);

            CREATE TABLE IF NOT EXISTS plugin_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '📦',
                color TEXT NOT NULL DEFAULT '#4FC3F7',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plugin_categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                group_id TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (group_id) REFERENCES plugin_groups(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_plugin_categories_group ON plugin_categories(group_id);
            ",
        )?;
        Ok(())
    }

    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    fn migrate(&self) -> crate::core::error::Result<()> {
        let conn = self.conn.lock().map_err(|e| Error::Internal(format!("DB lock poisoned: {}", e)))?;

        let has_group_id: bool = {
            let stmt = conn.prepare("SELECT group_id FROM notes LIMIT 1");
            stmt.is_ok()
        };

        if !has_group_id {
            conn.execute_batch(
                "
                ALTER TABLE notes ADD COLUMN group_id TEXT NOT NULL DEFAULT 'uncategorized';
                CREATE INDEX IF NOT EXISTS idx_notes_group ON notes(group_id);
                "
            )?;
        }

        let has_note_groups: bool = {
            let stmt = conn.prepare("SELECT id FROM note_groups LIMIT 1");
            stmt.is_ok()
        };

        if !has_note_groups {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS note_groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT '📁',
                    color TEXT NOT NULL DEFAULT '#6C63FF',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                "
            )?;
        }

        conn.execute("UPDATE notes SET group_id = '' WHERE group_id = 'uncategorized'", [])?;

        let has_cnl_context_idx: bool = {
            let mut stmt = conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cnl_context'"
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.count() > 0
        };

        if !has_cnl_context_idx {
            conn.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_cnl_context ON command_note_links(context);"
            )?;
        }

        let has_cnl_cascade: bool = {
            let result: String = conn.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='command_note_links'",
                [],
                |row| row.get(0),
            ).unwrap_or_default();
            result.contains("command_id) REFERENCES command_history(id) ON DELETE CASCADE")
        };

        if has_cnl_cascade {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS command_note_links_new (
                    id TEXT PRIMARY KEY,
                    command_id TEXT NOT NULL,
                    note_id TEXT NOT NULL,
                    context TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
                );
                INSERT OR IGNORE INTO command_note_links_new SELECT id, command_id, note_id, context, created_at FROM command_note_links;
                DROP TABLE command_note_links;
                ALTER TABLE command_note_links_new RENAME TO command_note_links;
                CREATE INDEX IF NOT EXISTS idx_cnl_command ON command_note_links(command_id);
                CREATE INDEX IF NOT EXISTS idx_cnl_note ON command_note_links(note_id);
                CREATE INDEX IF NOT EXISTS idx_cnl_context ON command_note_links(context);
                "
            )?;
        }

        let has_ai_logo: bool = {
            let stmt = conn.prepare("SELECT logo FROM ai_providers LIMIT 1");
            stmt.is_ok()
        };

        if !has_ai_logo {
            let _ = conn.execute_batch("ALTER TABLE ai_providers ADD COLUMN logo TEXT NOT NULL DEFAULT '';");
        }

        let has_ai_endpoints: bool = {
            let stmt = conn.prepare("SELECT id FROM ai_endpoints LIMIT 1");
            stmt.is_ok()
        };

        if !has_ai_endpoints {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS ai_endpoints (
                    id TEXT PRIMARY KEY,
                    provider_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    api_type TEXT NOT NULL DEFAULT 'openai-completions',
                    base_url TEXT NOT NULL DEFAULT '',
                    auth_type TEXT NOT NULL DEFAULT 'bearer',
                    custom_auth_header TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_ai_endpoints_provider ON ai_endpoints(provider_id);
                "
            )?;

            let has_provider_base_url: bool = {
                let stmt = conn.prepare("SELECT base_url FROM ai_providers LIMIT 1");
                stmt.is_ok()
            };

            if has_provider_base_url {
                let providers: Vec<(String, String, String)> = {
                    let mut stmt = conn.prepare("SELECT id, api_key, base_url FROM ai_providers WHERE base_url != ''")?;
                    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
                    rows.collect::<Result<Vec<_>, _>>()?
                };

                for (provider_id, _api_key, base_url) in providers {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    let endpoint_id = format!("ep-migrate-{}", &provider_id[..8.min(provider_id.len())]);
                    conn.execute(
                        "INSERT OR IGNORE INTO ai_endpoints (id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, 'openai-completions', ?4, 'bearer', '', 1, ?5, ?6)",
                        rusqlite::params![endpoint_id, provider_id, "Default", base_url, now, now],
                    )?;
                }
            }
        }

        let has_endpoint_id: bool = {
            let stmt = conn.prepare("SELECT endpoint_id FROM ai_models LIMIT 1");
            stmt.is_ok()
        };

        if !has_endpoint_id {
            let has_old_provider_id: bool = {
                let stmt = conn.prepare("SELECT provider_id FROM ai_models LIMIT 1");
                stmt.is_ok()
            };

            if has_old_provider_id {
                conn.execute_batch(
                    "
                    CREATE TABLE IF NOT EXISTS ai_models_new (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        ref_key TEXT NOT NULL,
                        endpoint_id TEXT NOT NULL DEFAULT '',
                        reasoning INTEGER NOT NULL DEFAULT 0,
                        input_types TEXT NOT NULL DEFAULT '[\"text\"]',
                        context_window INTEGER NOT NULL DEFAULT 128000,
                        max_tokens INTEGER NOT NULL DEFAULT 4096,
                        enabled INTEGER NOT NULL DEFAULT 1,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );

                    INSERT INTO ai_models_new (id, name, ref_key, endpoint_id, context_window, max_tokens, enabled, created_at, updated_at)
                        SELECT m.id, m.name, m.ref_key, COALESCE(e.id, ''), m.context_window, m.max_tokens, m.enabled, m.created_at, m.updated_at
                        FROM ai_models m
                        LEFT JOIN ai_endpoints e ON e.provider_id = m.provider_id;

                    DROP TABLE ai_models;
                    ALTER TABLE ai_models_new RENAME TO ai_models;
                    "
                )?;
            } else {
                conn.execute_batch(
                    "
                    ALTER TABLE ai_models ADD COLUMN endpoint_id TEXT NOT NULL DEFAULT '';
                    ALTER TABLE ai_models ADD COLUMN reasoning INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE ai_models ADD COLUMN input_types TEXT NOT NULL DEFAULT '[\"text\"]';
                    "
                )?;
            }
        }

        let has_reasoning: bool = {
            let stmt = conn.prepare("SELECT reasoning FROM ai_models LIMIT 1");
            stmt.is_ok()
        };

        if !has_reasoning {
            let _ = conn.execute_batch("ALTER TABLE ai_models ADD COLUMN reasoning INTEGER NOT NULL DEFAULT 0;");
        }

        let has_input_types: bool = {
            let stmt = conn.prepare("SELECT input_types FROM ai_models LIMIT 1");
            stmt.is_ok()
        };

        if !has_input_types {
            let _ = conn.execute_batch("ALTER TABLE ai_models ADD COLUMN input_types TEXT NOT NULL DEFAULT '[\"text\"]';");
        }

        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_ai_models_endpoint ON ai_models(endpoint_id);");

        let has_trigger_type: bool = {
            let stmt = conn.prepare("SELECT trigger_type FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_trigger_type {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';");
        }

        let has_auto_confirm: bool = {
            let stmt = conn.prepare("SELECT auto_confirm FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_auto_confirm {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN auto_confirm INTEGER NOT NULL DEFAULT 0;");
        }

        let has_permission_mode: bool = {
            let stmt = conn.prepare("SELECT permission_mode FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_permission_mode {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'confirm';");
        }

        let has_always_allowed_tools: bool = {
            let stmt = conn.prepare("SELECT always_allowed_tools FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_always_allowed_tools {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN always_allowed_tools TEXT NOT NULL DEFAULT '[]';");
        }

        let has_fallback_model_id: bool = {
            let stmt = conn.prepare("SELECT fallback_model_id FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_fallback_model_id {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN fallback_model_id TEXT NOT NULL DEFAULT '';");
        }

        let has_workspace_dir: bool = {
            let stmt = conn.prepare("SELECT workspace_dir FROM ai_agents LIMIT 1");
            stmt.is_ok()
        };

        if !has_workspace_dir {
            let _ = conn.execute_batch("ALTER TABLE ai_agents ADD COLUMN workspace_dir TEXT NOT NULL DEFAULT '';");
        }

        let has_conv_metadata: bool = {
            let stmt = conn.prepare("SELECT metadata FROM ai_conversations LIMIT 1");
            stmt.is_ok()
        };

        if !has_conv_metadata {
            let _ = conn.execute_batch("ALTER TABLE ai_conversations ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';");
        }

        let has_msg_is_error: bool = {
            let stmt = conn.prepare("SELECT is_error FROM ai_messages LIMIT 1");
            stmt.is_ok()
        };

        if !has_msg_is_error {
            let _ = conn.execute_batch("ALTER TABLE ai_messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0;");
        }

        let has_conv_compaction: bool = {
            let stmt = conn.prepare("SELECT compaction_summary FROM ai_conversations LIMIT 1");
            stmt.is_ok()
        };

        if !has_conv_compaction {
            let _ = conn.execute_batch("ALTER TABLE ai_conversations ADD COLUMN compaction_summary TEXT NOT NULL DEFAULT '';");
        }

        // Migration: Fix ai_agents foreign key constraint to allow ON DELETE SET NULL
        // This prevents "FOREIGN KEY constraint failed" when deleting models
        let has_correct_fk: bool = {
            let result: String = conn.query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_agents'",
                [],
                |row| row.get(0),
            ).unwrap_or_default();
            result.contains("model_id) REFERENCES ai_models(id) ON DELETE SET NULL")
        };

        if !has_correct_fk {
            conn.execute_batch(
                "
                -- Create new table with correct foreign key constraint
                CREATE TABLE IF NOT EXISTS ai_agents_new (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    model_id TEXT,
                    system_prompt TEXT NOT NULL DEFAULT '',
                    temperature REAL NOT NULL DEFAULT 0.7,
                    max_iterations INTEGER NOT NULL DEFAULT 10,
                    tool_ids TEXT NOT NULL DEFAULT '[]',
                    trigger_type TEXT NOT NULL DEFAULT 'manual',
                    fallback_model_id TEXT,
                    workspace_dir TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
                    FOREIGN KEY (fallback_model_id) REFERENCES ai_models(id) ON DELETE SET NULL
                );

                -- Copy data from old table (convert '' to NULL for model_id and fallback_model_id)
                INSERT INTO ai_agents_new (
                    id, name, description, model_id, system_prompt, temperature,
                    max_iterations, tool_ids, trigger_type, fallback_model_id,
                    workspace_dir, created_at, updated_at
                )
                SELECT 
                    id, name, description,
                    CASE WHEN model_id = '' THEN NULL ELSE model_id END,
                    system_prompt, temperature, max_iterations, tool_ids, trigger_type,
                    CASE WHEN fallback_model_id = '' THEN NULL ELSE fallback_model_id END,
                    workspace_dir, created_at, updated_at
                FROM ai_agents;

                -- Drop old table and rename new one
                DROP TABLE ai_agents;
                ALTER TABLE ai_agents_new RENAME TO ai_agents;
                "
            )?;
        }

        Ok(())
    }
}
