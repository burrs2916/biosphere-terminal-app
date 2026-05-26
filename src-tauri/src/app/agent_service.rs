#![allow(dead_code)]

use std::sync::Arc;

use crate::app::notebook_service::NotebookService;
use crate::app::terminal_service::TerminalService;
use crate::infra::storage::database::Database;
use crate::infra::storage::agent_repo::{
    AiProviderRepo, AiProviderRow,
    AiEndpointRepo, AiEndpointRow,
    AiModelRepo, AiModelRow,
    AiAgentRepo, AiAgentRow,
    AiConversationRepo, AiConversationRow,
    AiMessageRepo, AiMessageRow,
};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub struct AgentService {
    db: Arc<Database>,
    notebook: Arc<NotebookService>,
    terminal: Arc<TerminalService>,
}

impl AgentService {
    pub fn new(db: Arc<Database>, notebook: Arc<NotebookService>, terminal: Arc<TerminalService>) -> Self {
        AgentService { db, notebook, terminal }
    }

    pub fn db(&self) -> Arc<Database> {
        self.db.clone()
    }

    pub fn notebook(&self) -> Arc<NotebookService> {
        self.notebook.clone()
    }

    pub fn terminal(&self) -> Arc<TerminalService> {
        self.terminal.clone()
    }

    pub fn list_providers(&self) -> Result<Vec<AiProviderRow>, String> {
        AiProviderRepo::list(&self.db)
    }

    pub fn get_provider_by_id(&self, id: &str) -> Result<Option<AiProviderRow>, String> {
        AiProviderRepo::get_by_id(&self.db, id)
    }

    pub fn save_provider(&self, provider: AiProviderRow) -> Result<(), String> {
        AiProviderRepo::save(&self.db, &provider)
    }

    pub fn delete_provider(&self, id: &str) -> Result<(), String> {
        AiProviderRepo::delete(&self.db, id)
    }

    pub fn list_endpoints(&self) -> Result<Vec<AiEndpointRow>, String> {
        AiEndpointRepo::list(&self.db)
    }

    pub fn get_endpoint_by_id(&self, id: &str) -> Result<Option<AiEndpointRow>, String> {
        AiEndpointRepo::get_by_id(&self.db, id)
    }

    pub fn list_endpoints_by_provider(&self, provider_id: &str) -> Result<Vec<AiEndpointRow>, String> {
        AiEndpointRepo::list_by_provider(&self.db, provider_id)
    }

    pub fn save_endpoint(&self, endpoint: AiEndpointRow) -> Result<(), String> {
        AiEndpointRepo::save(&self.db, &endpoint)
    }

    pub fn delete_endpoint(&self, id: &str) -> Result<(), String> {
        AiEndpointRepo::delete(&self.db, id)
    }

    pub fn list_models(&self) -> Result<Vec<AiModelRow>, String> {
        AiModelRepo::list(&self.db)
    }

    pub fn get_model_by_id(&self, id: &str) -> Result<Option<AiModelRow>, String> {
        AiModelRepo::get_by_id(&self.db, id)
    }

    pub fn list_models_by_endpoint(&self, endpoint_id: &str) -> Result<Vec<AiModelRow>, String> {
        AiModelRepo::list_by_endpoint(&self.db, endpoint_id)
    }

    pub fn save_model(&self, model: AiModelRow) -> Result<(), String> {
        AiModelRepo::save(&self.db, &model)
    }

    pub fn delete_model(&self, id: &str) -> Result<(), String> {
        AiModelRepo::delete(&self.db, id)
    }

    pub async fn test_endpoint_connection(&self, endpoint_id: &str) -> Result<String, String> {
        let endpoint = AiEndpointRepo::get_by_id(&self.db, endpoint_id)?
            .ok_or_else(|| "Endpoint not found".to_string())?;

        let provider = AiProviderRepo::get_by_id(&self.db, &endpoint.provider_id)?
            .ok_or_else(|| "Provider not found".to_string())?;

        let url = format!("{}/models", endpoint.base_url.trim_end_matches('/'));
        let client = reqwest::Client::new();

        let mut req = client.get(&url);
        match endpoint.auth_type.as_str() {
            "bearer" => {
                req = req.header("Authorization", format!("Bearer {}", provider.api_key));
            }
            "x-api-key" => {
                req = req.header("x-api-key", &provider.api_key);
            }
            "custom" => {
                if !endpoint.custom_auth_header.is_empty() {
                    req = req.header(&endpoint.custom_auth_header, &provider.api_key);
                }
            }
            _ => {}
        }

        let resp = req.send().await.map_err(|e| format!("Connection failed: {}", e))?;
        let status = resp.status();

        if status.is_success() {
            Ok(format!("Connection successful (HTTP {})", status))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Connection failed (HTTP {}): {}", status, body.chars().take(200).collect::<String>()))
        }
    }

    pub async fn test_model_chat(&self, model_id: &str) -> Result<String, String> {
        let model = AiModelRepo::get_by_id(&self.db, model_id)?
            .ok_or_else(|| "Model not found".to_string())?;

        let endpoint = AiEndpointRepo::get_by_id(&self.db, &model.endpoint_id)?
            .ok_or_else(|| "Endpoint not found".to_string())?;

        let provider = AiProviderRepo::get_by_id(&self.db, &endpoint.provider_id)?
            .ok_or_else(|| "Provider not found".to_string())?;

        let url = match endpoint.api_type.as_str() {
            "anthropic-messages" => format!("{}/v1/messages", endpoint.base_url.trim_end_matches('/')),
            _ => format!("{}/chat/completions", endpoint.base_url.trim_end_matches('/')),
        };
        let client = reqwest::Client::new();

        let body = match endpoint.api_type.as_str() {
            "anthropic-messages" => serde_json::json!({
                "model": model.ref_key,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 10,
            }),
            _ => serde_json::json!({
                "model": model.ref_key,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 10,
            }),
        };

        let mut req = client.post(&url)
            .header("Content-Type", "application/json")
            .json(&body);

        if endpoint.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        match endpoint.auth_type.as_str() {
            "bearer" => {
                req = req.header("Authorization", format!("Bearer {}", provider.api_key));
            }
            "x-api-key" => {
                req = req.header("x-api-key", &provider.api_key);
            }
            "custom" => {
                if !endpoint.custom_auth_header.is_empty() {
                    req = req.header(&endpoint.custom_auth_header, &provider.api_key);
                }
            }
            _ => {}
        }

        let resp = req.send().await.map_err(|e| format!("Request failed: {}", e))?;
        let status = resp.status();

        if status.is_success() {
            let _text = resp.text().await.unwrap_or_default();
            Ok(format!("Model test successful (HTTP {})", status))
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Model test failed (HTTP {}): {}", status, body.chars().take(200).collect::<String>()))
        }
    }

    pub fn list_agents(&self) -> Result<Vec<AiAgentRow>, String> {
        AiAgentRepo::list(&self.db)
    }

    pub fn get_agent_by_id(&self, id: &str) -> Result<Option<AiAgentRow>, String> {
        AiAgentRepo::get_by_id(&self.db, id)
    }

    pub fn save_agent(&self, agent: AiAgentRow) -> Result<(), String> {
        AiAgentRepo::save(&self.db, &agent)
    }

    pub fn delete_agent(&self, id: &str) -> Result<(), String> {
        AiAgentRepo::delete(&self.db, id)
    }

    pub fn list_conversations(&self, agent_id: &str) -> Result<Vec<AiConversationRow>, String> {
        AiConversationRepo::list_by_agent(&self.db, agent_id)
    }

    pub fn create_conversation(&self, agent_id: &str, title: &str) -> Result<AiConversationRow, String> {
        self.create_conversation_with_metadata(agent_id, title, "{}")
    }

    pub fn create_conversation_with_metadata(&self, agent_id: &str, title: &str, metadata: &str) -> Result<AiConversationRow, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let conv = AiConversationRow {
            id,
            agent_id: agent_id.to_string(),
            title: title.to_string(),
            metadata: metadata.to_string(),
            compaction_summary: String::new(),
            created_at: now,
            updated_at: now,
        };
        AiConversationRepo::save(&self.db, &conv)?;
        Ok(conv)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        AiConversationRepo::delete(&self.db, id)
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<AiMessageRow>, String> {
        AiMessageRepo::list_by_conversation(&self.db, conversation_id)
    }

    pub fn save_message(&self, msg: AiMessageRow) -> Result<(), String> {
        AiMessageRepo::save(&self.db, &msg)
    }

    pub fn delete_messages_after(&self, conversation_id: &str, after_message_id: &str) -> Result<(), String> {
        AiMessageRepo::delete_after(&self.db, conversation_id, after_message_id)
    }

    pub fn find_conversation(&self, id: &str) -> Result<Option<AiConversationRow>, String> {
        AiConversationRepo::find_by_id(&self.db, id)
    }

    pub fn update_conversation_title(&self, id: &str, title: &str) -> Result<(), String> {
        if let Some(mut conv) = AiConversationRepo::find_by_id(&self.db, id)? {
            conv.title = title.to_string();
            conv.updated_at = now_ms();
            AiConversationRepo::save(&self.db, &conv)?;
        }
        Ok(())
    }

    pub fn touch_conversation(&self, id: &str) -> Result<(), String> {
        if let Some(mut conv) = AiConversationRepo::find_by_id(&self.db, id)? {
            conv.updated_at = now_ms();
            AiConversationRepo::save(&self.db, &conv)?;
        }
        Ok(())
    }

    pub fn update_compaction_summary(&self, id: &str, summary: &str) -> Result<(), String> {
        AiConversationRepo::update_compaction_summary(&self.db, id, summary)
    }
}
