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
    pub model_id: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_iterations: i32,
    pub tool_ids: Vec<String>,
    pub trigger_type: String,
    pub auto_confirm: bool,
    pub linked_note_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
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
        conn.execute("DELETE FROM ai_models WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct AiAgentRepo;

impl AiAgentRepo {
    pub fn list(db: &Database) -> Result<Vec<AiAgentRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, trigger_type, auto_confirm, linked_note_ids, created_at, updated_at FROM ai_agents ORDER BY name")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let tool_ids_str: String = row.get(7)?;
                let tool_ids: Vec<String> = serde_json::from_str(&tool_ids_str).unwrap_or_default();
                let trigger_type: String = row.get(8)?;
                let auto_confirm: i32 = row.get(9)?;
                let linked_note_ids_str: String = row.get(10).unwrap_or_default();
                let linked_note_ids: Vec<String> = serde_json::from_str(&linked_note_ids_str).unwrap_or_default();
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
                    linked_note_ids,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, agent: &AiAgentRow) -> Result<(), String> {
        let conn = db.conn();
        let tool_ids_json = serde_json::to_string(&agent.tool_ids).unwrap_or_else(|_| "[]".to_string());
        let linked_note_ids_json = serde_json::to_string(&agent.linked_note_ids).unwrap_or_else(|_| "[]".to_string());
        let auto_confirm = if agent.auto_confirm { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO ai_agents (id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, trigger_type, auto_confirm, linked_note_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![agent.id, agent.name, agent.description, agent.model_id, agent.system_prompt, agent.temperature, agent.max_iterations, tool_ids_json, agent.trigger_type, auto_confirm, linked_note_ids_json, agent.created_at, agent.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), String> {
        let conn = db.conn();
        conn.execute("DELETE FROM ai_conversations WHERE agent_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_agents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct AiConversationRepo;

impl AiConversationRepo {
    pub fn list_by_agent(db: &Database, agent_id: &str) -> Result<Vec<AiConversationRow>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare("SELECT id, agent_id, title, created_at, updated_at FROM ai_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![agent_id], |row| {
                Ok(AiConversationRow {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, conv: &AiConversationRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO ai_conversations (id, agent_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![conv.id, conv.agent_id, conv.title, conv.created_at, conv.updated_at],
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
        let mut stmt = conn
            .prepare("SELECT id, conversation_id, role, content, tool_calls, created_at FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(AiMessageRow {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save(db: &Database, msg: &AiMessageRow) -> Result<(), String> {
        let conn = db.conn();
        conn.execute(
            "INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_calls, msg.created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
