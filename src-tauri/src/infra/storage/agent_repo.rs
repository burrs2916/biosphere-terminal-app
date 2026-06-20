use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::infra::storage::database::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderRow {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub logo: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEndpointRow {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub auth_type: String,
    pub custom_auth_header: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelRow {
    pub id: String,
    pub name: String,
    pub ref_key: String,
    pub endpoint_id: String,
    pub reasoning: bool,
    pub input_types: Vec<String>,
    pub context_window: i64,
    pub max_tokens: i64,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub model_id: Option<String>,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_iterations: i32,
    pub tool_ids: Vec<String>,
    pub trigger_type: String,
    pub auto_confirm: bool,
    pub permission_mode: String,
    pub always_allowed_tools: Vec<String>,
    pub fallback_model_id: Option<String>,
    pub workspace_dir: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub metadata: String,
    pub compaction_summary: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: String,
    pub is_error: i32,
    pub created_at: i64,
}

pub struct AiProviderRepo;

impl AiProviderRepo {
    pub fn list(db: &Database) -> Result<Vec<AiProviderRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, api_key, logo, enabled, created_at, updated_at FROM ai_providers ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let enabled: i32 = row.get(4)?;
                Ok(AiProviderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    api_key: row.get(2)?,
                    logo: row.get(3)?,
                    enabled: enabled != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, provider: &AiProviderRow) -> Result<(), String> {
        let conn = db.conn();
        let enabled = if provider.enabled { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO ai_providers (id, name, api_key, logo, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![provider.id, provider.name, provider.api_key, provider.logo, enabled, provider.created_at, provider.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM ai_models WHERE endpoint_id IN (SELECT id FROM ai_endpoints WHERE provider_id = ?1)", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_endpoints WHERE provider_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_providers WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<AiProviderRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, api_key, logo, enabled, created_at, updated_at FROM ai_providers WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| {
                let enabled: i32 = row.get(4)?;
                Ok(AiProviderRow {
                    id: row.get(0)?, name: row.get(1)?, api_key: row.get(2)?,
                    logo: row.get(3)?, enabled: enabled != 0,
                    created_at: row.get(5)?, updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result: Vec<AiProviderRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginGroupRow {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
    #[serde(default)]
    pub plugin_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct PluginGroupRepo;

impl PluginGroupRepo {
    pub fn list(db: &Database) -> Result<Vec<PluginGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, icon, color, sort_order, created_at, updated_at FROM plugin_groups ORDER BY sort_order ASC, name ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PluginGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    plugin_count: 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get(db: &Database, id: &str) -> Result<Option<PluginGroupRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, icon, color, sort_order, created_at, updated_at FROM plugin_groups WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![id], |row| {
                Ok(PluginGroupRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    plugin_count: 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result: Vec<PluginGroupRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }

    pub fn save(db: &Database, group: &PluginGroupRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO plugin_groups (id, name, icon, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![group.id, group.name, group.icon, group.color, group.sort_order, group.created_at, group.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM plugin_groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCategoryRow {
    pub id: String,
    pub name: String,
    pub group_id: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct PluginCategoryRepo;

impl PluginCategoryRepo {
    pub fn list_by_group(db: &Database, group_id: &str) -> Result<Vec<PluginCategoryRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, group_id, is_default, sort_order, created_at, updated_at FROM plugin_categories WHERE group_id = ?1 ORDER BY sort_order ASC, name ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![group_id], |row| {
                let is_default: i32 = row.get(3)?;
                Ok(PluginCategoryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    group_id: row.get(2)?,
                    is_default: is_default != 0,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, cat: &PluginCategoryRow) -> Result<(), String> {
        let conn = db.conn();
        let is_default = if cat.is_default { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO plugin_categories (id, name, group_id, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![cat.id, cat.name, cat.group_id, is_default, cat.sort_order, cat.created_at, cat.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM plugin_categories WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct AiEndpointRepo;

impl AiEndpointRepo {
    pub fn list(db: &Database) -> Result<Vec<AiEndpointRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at FROM ai_endpoints ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let enabled: i32 = row.get(7)?;
                Ok(AiEndpointRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    name: row.get(2)?,
                    api_type: row.get(3)?,
                    base_url: row.get(4)?,
                    auth_type: row.get(5)?,
                    custom_auth_header: row.get(6)?,
                    enabled: enabled != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_provider(db: &Database, provider_id: &str) -> Result<Vec<AiEndpointRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at FROM ai_endpoints WHERE provider_id = ?1 ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![provider_id], |row| {
                let enabled: i32 = row.get(7)?;
                Ok(AiEndpointRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    name: row.get(2)?,
                    api_type: row.get(3)?,
                    base_url: row.get(4)?,
                    auth_type: row.get(5)?,
                    custom_auth_header: row.get(6)?,
                    enabled: enabled != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, endpoint: &AiEndpointRow) -> Result<(), String> {
        let conn = db.conn();
        let enabled = if endpoint.enabled { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO ai_endpoints (id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![endpoint.id, endpoint.provider_id, endpoint.name, endpoint.api_type, endpoint.base_url, endpoint.auth_type, endpoint.custom_auth_header, enabled, endpoint.created_at, endpoint.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM ai_models WHERE endpoint_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_endpoints WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<AiEndpointRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at FROM ai_endpoints WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| {
                let enabled: i32 = row.get(7)?;
                Ok(AiEndpointRow {
                    id: row.get(0)?, provider_id: row.get(1)?, name: row.get(2)?,
                    api_type: row.get(3)?, base_url: row.get(4)?, auth_type: row.get(5)?,
                    custom_auth_header: row.get(6)?, enabled: enabled != 0,
                    created_at: row.get(8)?, updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result: Vec<AiEndpointRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }
}

pub struct AiModelRepo;

impl AiModelRepo {
    pub fn list(db: &Database) -> Result<Vec<AiModelRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at FROM ai_models ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let reasoning: i32 = row.get(4)?;
                let enabled: i32 = row.get(8)?;
                let input_types_str: String = row.get(5)?;
                let input_types: Vec<String> = serde_json::from_str(&input_types_str).unwrap_or_else(|_| vec!["text".to_string()]);
                Ok(AiModelRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    ref_key: row.get(2)?,
                    endpoint_id: row.get(3)?,
                    reasoning: reasoning != 0,
                    input_types,
                    context_window: row.get(6)?,
                    max_tokens: row.get(7)?,
                    enabled: enabled != 0,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_by_endpoint(db: &Database, endpoint_id: &str) -> Result<Vec<AiModelRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at FROM ai_models WHERE endpoint_id = ?1 ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![endpoint_id], |row| {
                let reasoning: i32 = row.get(4)?;
                let enabled: i32 = row.get(8)?;
                let input_types_str: String = row.get(5)?;
                let input_types: Vec<String> = serde_json::from_str(&input_types_str).unwrap_or_else(|_| vec!["text".to_string()]);
                Ok(AiModelRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    ref_key: row.get(2)?,
                    endpoint_id: row.get(3)?,
                    reasoning: reasoning != 0,
                    input_types,
                    context_window: row.get(6)?,
                    max_tokens: row.get(7)?,
                    enabled: enabled != 0,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, model: &AiModelRow) -> Result<(), String> {
        let conn = db.conn();
        let enabled = if model.enabled { 1 } else { 0 };
        let reasoning = if model.reasoning { 1 } else { 0 };
        let input_types_json = serde_json::to_string(&model.input_types).unwrap_or_else(|_| "[\"text\"]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO ai_models (id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![model.id, model.name, model.ref_key, model.endpoint_id, reasoning, input_types_json, model.context_window, model.max_tokens, enabled, model.created_at, model.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        // Unlink agents that reference this model (both model_id and fallback_model_id)
        // Use NULL instead of empty string to comply with foreign key constraints
        conn.execute("UPDATE ai_agents SET model_id = NULL WHERE model_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("UPDATE ai_agents SET fallback_model_id = NULL WHERE fallback_model_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // Delete the model and verify a row was actually removed
        let rows = conn.execute("DELETE FROM ai_models WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if rows == 0 {
            return Err(format!("Model {} not found", id));
        }
        Ok(())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<AiModelRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at FROM ai_models WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| {
                let reasoning: i32 = row.get(4)?;
                let enabled: i32 = row.get(8)?;
                let input_types_str: String = row.get(5)?;
                let input_types: Vec<String> = serde_json::from_str(&input_types_str).unwrap_or_else(|_| vec!["text".to_string()]);
                Ok(AiModelRow {
                    id: row.get(0)?, name: row.get(1)?, ref_key: row.get(2)?,
                    endpoint_id: row.get(3)?, reasoning: reasoning != 0, input_types,
                    context_window: row.get(6)?, max_tokens: row.get(7)?,
                    enabled: enabled != 0, created_at: row.get(9)?, updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result: Vec<AiModelRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }
}

pub struct AiAgentRepo;

impl AiAgentRepo {
    pub fn list(db: &Database) -> Result<Vec<AiAgentRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, trigger_type, auto_confirm, permission_mode, always_allowed_tools, fallback_model_id, workspace_dir, created_at, updated_at FROM ai_agents ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let tool_ids_str: String = row.get(7)?;
                let tool_ids: Vec<String> = serde_json::from_str(&tool_ids_str).unwrap_or_default();
                let trigger_type: String = row.get(8)?;
                let auto_confirm: i32 = row.get(9)?;
                let permission_mode: String = row.get(10)?;
                let always_allowed_str: String = row.get(11)?;
                let always_allowed_tools: Vec<String> = serde_json::from_str(&always_allowed_str).unwrap_or_default();
                let fallback_model_id: Option<String> = row.get(12)?;
                let workspace_dir: String = row.get(13)?;
                Ok(AiAgentRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    model_id: row.get(3)?,
                    system_prompt: row.get(4)?,
                    temperature: row.get(5)?,
                    max_iterations: row.get(6)?,
                    tool_ids,
                    trigger_type,
                    auto_confirm: auto_confirm != 0,
                    permission_mode,
                    always_allowed_tools,
                    fallback_model_id,
                    workspace_dir,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, agent: &AiAgentRow) -> Result<(), String> {
        let conn = db.conn();
        let tool_ids_json = serde_json::to_string(&agent.tool_ids).unwrap_or_else(|_| "[]".to_string());
        let auto_confirm = if agent.auto_confirm { 1 } else { 0 };
        let always_allowed_json = serde_json::to_string(&agent.always_allowed_tools).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO ai_agents (id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, trigger_type, auto_confirm, permission_mode, always_allowed_tools, fallback_model_id, workspace_dir, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, model_id=excluded.model_id, system_prompt=excluded.system_prompt, temperature=excluded.temperature, max_iterations=excluded.max_iterations, tool_ids=excluded.tool_ids, trigger_type=excluded.trigger_type, auto_confirm=excluded.auto_confirm, permission_mode=excluded.permission_mode, always_allowed_tools=excluded.always_allowed_tools, fallback_model_id=excluded.fallback_model_id, workspace_dir=excluded.workspace_dir, updated_at=excluded.updated_at",
            params![agent.id, agent.name, agent.description, agent.model_id, agent.system_prompt, agent.temperature, agent.max_iterations, tool_ids_json, agent.trigger_type, auto_confirm, agent.permission_mode, always_allowed_json, agent.fallback_model_id, agent.workspace_dir, agent.created_at, agent.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        // Clean up messages for all conversations owned by this agent
        conn.execute(
            "DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE agent_id = ?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_conversations WHERE agent_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_agents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_by_id(db: &Database, id: &str) -> Result<Option<AiAgentRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, trigger_type, auto_confirm, permission_mode, always_allowed_tools, fallback_model_id, workspace_dir, created_at, updated_at FROM ai_agents WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| {
                let tool_ids_str: String = row.get(7)?;
                let tool_ids: Vec<String> = serde_json::from_str(&tool_ids_str).unwrap_or_default();
                let auto_confirm: i32 = row.get(9)?;
                let always_allowed_str: String = row.get(11)?;
                let always_allowed_tools: Vec<String> = serde_json::from_str(&always_allowed_str).unwrap_or_default();
                Ok(AiAgentRow {
                    id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
                    model_id: row.get(3)?, system_prompt: row.get(4)?, temperature: row.get(5)?,
                    max_iterations: row.get(6)?, tool_ids, trigger_type: row.get(8)?,
                    auto_confirm: auto_confirm != 0, permission_mode: row.get(10)?,
                    always_allowed_tools, fallback_model_id: row.get(12)?,
                    workspace_dir: row.get(13)?, created_at: row.get(14)?, updated_at: row.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result: Vec<AiAgentRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }
}

pub struct AiConversationRepo;

impl AiConversationRepo {
    pub fn find_by_id(db: &Database, id: &str) -> Result<Option<AiConversationRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, agent_id, title, metadata, compaction_summary, created_at, updated_at FROM ai_conversations WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![id], |row| {
                Ok(AiConversationRow {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    metadata: row.get(3)?,
                    compaction_summary: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result: Vec<AiConversationRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(result.pop())
    }

    pub fn list_by_agent(db: &Database, agent_id: &str) -> Result<Vec<AiConversationRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, agent_id, title, metadata, compaction_summary, created_at, updated_at FROM ai_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![agent_id], |row| {
                Ok(AiConversationRow {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    metadata: row.get(3)?,
                    compaction_summary: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, conv: &AiConversationRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO ai_conversations (id, agent_id, title, metadata, compaction_summary, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET agent_id=excluded.agent_id, title=excluded.title, metadata=excluded.metadata, compaction_summary=excluded.compaction_summary, updated_at=excluded.updated_at",
            params![conv.id, conv.agent_id, conv.title, conv.metadata, conv.compaction_summary, conv.created_at, conv.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_compaction_summary(db: &Database, id: &str, summary: &str) -> Result<(), String> {
        let conn = db.conn();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "UPDATE ai_conversations SET compaction_summary = ?1, updated_at = ?2 WHERE id = ?3",
            params![summary, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM ai_messages WHERE conversation_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_conversations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct AiMessageRepo;

impl AiMessageRepo {
    pub fn list_by_conversation(db: &Database, conversation_id: &str) -> Result<Vec<AiMessageRow>, String> {
        let conn = db.conn();
        let total_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ai_messages", [], |row| row.get(0),
        ).unwrap_or(-1);
        let conv_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ai_messages WHERE conversation_id = ?1", rusqlite::params![conversation_id], |row| row.get(0),
        ).unwrap_or(-1);
        tracing::info!("[AiMessageRepo::list_by_conversation] conv_id={}, total_in_table={}, for_this_conv={}", conversation_id, total_count, conv_count);
        let mut stmt = conn
            .prepare("SELECT id, conversation_id, role, content, tool_calls, is_error, created_at FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(AiMessageRow {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get(4)?,
                    is_error: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, msg: &AiMessageRow) -> Result<(), String> {
        let conn = db.conn();
        let rows = conn.execute(
            "INSERT INTO ai_messages (id, conversation_id, role, content, tool_calls, is_error, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET content=excluded.content, tool_calls=excluded.tool_calls, is_error=excluded.is_error",
            params![msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_calls, msg.is_error, msg.created_at],
        )
        .map_err(|e| e.to_string())?;
        tracing::info!("[AiMessageRepo::save] id={}, role={}, conv_id={}, rows_affected={}", msg.id, msg.role, msg.conversation_id, rows);
        Ok(())
    }

    pub fn delete_after(db: &Database, conversation_id: &str, after_message_id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "DELETE FROM ai_messages WHERE conversation_id = ?1 AND created_at >= (SELECT created_at FROM ai_messages WHERE id = ?2)",
            params![conversation_id, after_message_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
