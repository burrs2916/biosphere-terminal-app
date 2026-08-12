use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

const PLUGIN_MANAGER_DESCRIPTION: &str = "\
Manage plugins: create, refine, test, and analyze AI-powered tools.

## WORKFLOW:
1. **Create**: action='create' → action='test' → fix with action='refine' if needed → test again
2. **Refine**: action='analyze_usage' (get fix suggestions) → action='refine' with patch_tools → action='test'
3. **Always test** after create/refine. Use patch_tools for incremental changes.

## SCRIPT FORMATS:
1. **Script file** (RECOMMENDED): 'script:INTERPRETER\\nSCRIPT_CONTENT' — Use {{param_name}} for substitution. {{workspace_dir}} is a DIRECTORY — always append filename: {{workspace_dir}}/result.json
2. **Shell**: 'shell: COMMAND' — Simple one-liners only. Use {{param_name}} for substitution.
3. **HTTP**: 'METHOD URL_TEMPLATE' — Real external APIs only.
NEVER use 'shell: python3 -c \"...\"' for complex code — use 'script:python3' instead.

## PARAMETER UI HINTS (always add to parameters):
- ui_widget: 'file'|'select'|'textarea'|'number'|'checkbox'|'text'
- ui_label: Human-readable name (e.g. 'Input File')
- ui_placeholder: Hint text | ui_options: Choices for 'select' | ui_accept: File filter for 'file'

## RESULT VIEW: Set result_view on tools: { viewType: 'table'|'list'|'json'|'markdown'|'text' }

## RULES:
- Always include scenarios and trigger_keywords when creating
- Add ui_* hints to parameters; set result_view for structured output
- If dependency missing, add auto-install: subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'PKG', '-q'])
- Print results to stdout only. Create test data inside test scripts.
- NEVER use {{workspace_dir}} as a file path — it's a DIRECTORY. Always append a filename.
";

use crate::app::plugin_service::PluginService;
use crate::app::agent_service::AgentService;
use crate::plugins::domain::plugin::{PluginManifest, PluginScenario, PluginTool, ToolParameter};
use crate::plugins::domain::changelog::{ChangelogEntry, ToolChange};
use crate::plugins::domain::ui_schema::UiSchema;
use super::engine::{AgentTool, ToolOutput, ToolRegistry};
use super::plugin_tool::PluginAgentTool;

pub struct PluginManagerTool {
    plugin_service: Arc<PluginService>,
    tool_registry: Option<Arc<Mutex<ToolRegistry>>>,
    agent_service: Option<Arc<AgentService>>,
    current_agent_id: Option<String>,
    workspace_dir: PathBuf,
}

impl PluginManagerTool {
    #[allow(dead_code)]
    pub fn new(plugin_service: Arc<PluginService>) -> Self {
        let workspace_dir = std::env::temp_dir();
        PluginManagerTool {
            plugin_service,
            tool_registry: None,
            agent_service: None,
            current_agent_id: None,
            workspace_dir,
        }
    }

    pub fn with_context(
        plugin_service: Arc<PluginService>,
        tool_registry: Arc<Mutex<ToolRegistry>>,
        agent_service: Arc<AgentService>,
        agent_id: String,
        workspace_dir: PathBuf,
    ) -> Self {
        PluginManagerTool {
            plugin_service,
            tool_registry: Some(tool_registry),
            agent_service: Some(agent_service),
            current_agent_id: Some(agent_id),
            workspace_dir,
        }
    }
}

#[async_trait]
impl AgentTool for PluginManagerTool {
    fn name(&self) -> &str {
        "plugin_manager"
    }

    fn description(&self) -> &str {
        PLUGIN_MANAGER_DESCRIPTION
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "get", "create", "update", "delete", "toggle", "list_tools", "test", "refine", "analyze_usage"],
                    "description": "Action: list|get|create|update|delete|toggle|list_tools|test|refine|analyze_usage. For refine, prefer patch_tools over replacing all tools."
                },
                "plugin_id": {
                    "type": "string",
                    "description": "Plugin ID (for 'get', 'update', 'delete', 'toggle' actions)"
                },
                "tool_name": {
                    "type": "string",
                    "description": "Tool name within a plugin (for 'test' action)"
                },
                "test_params": {
                    "type": "object",
                    "description": "Parameters to pass to the tool being tested (for 'test' action)"
                },
                "name": {
                    "type": "string",
                    "description": "Plugin name (for 'create', 'update' actions)"
                },
                "version": {
                    "type": "string",
                    "description": "Plugin version, e.g. '1.0.0' (for 'create', 'update' actions)"
                },
                "description": {
                    "type": "string",
                    "description": "Plugin description (for 'create', 'update' actions)"
                },
                "author": {
                    "type": "string",
                    "description": "Plugin author (for 'create', 'update' actions)"
                },
                "enabled": {
                    "type": "boolean",
                    "description": "Whether the plugin is enabled (for 'toggle' action)"
                },
                "tools": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "Tool name (unique identifier)" },
                            "description": { "type": "string", "description": "What this tool does" },
                            "script": { "type": "string", "description": "Script format: 'script:INTERPRETER\\nCODE' (recommended), 'shell: CMD' (one-liners), 'METHOD URL' (HTTP). Use {{param}} for substitution. {{workspace_dir}} is a DIRECTORY — append filename." },
                            "parameters": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": { "type": "string" },
                                        "param_type": { "type": "string", "enum": ["string", "number", "boolean", "object", "array"] },
                                        "required": { "type": "boolean" },
                                        "description": { "type": "string" },
                                        "default_value": {},
                                        "ui_widget": { "type": "string", "enum": ["text", "textarea", "number", "select", "checkbox", "file"], "description": "UI widget type for user-friendly input. Use 'file' for file paths, 'select' for choices, 'textarea' for long text." },
                                        "ui_label": { "type": "string", "description": "Human-readable label (e.g. 'Input File' instead of 'input_path')" },
                                        "ui_placeholder": { "type": "string", "description": "Placeholder hint text" },
                                        "ui_options": { "type": "array", "items": { "type": "string" }, "description": "Options for 'select' widget" },
                                        "ui_accept": { "type": "string", "description": "File type filter for 'file' widget (e.g. '.pptx,.ppt')" },
                                        "ui_group": { "type": "string", "description": "Group name for organizing parameters" },
                                        "ui_order": { "type": "number", "description": "Display order (lower = first)" }
                                    },
                                    "required": ["name", "param_type", "required", "description"]
                                },
                                "description": "Tool parameters. ALWAYS add ui_widget, ui_label, ui_placeholder for user-friendly forms. For file paths use ui_widget='file' with ui_accept. For choices use ui_widget='select' with ui_options."
                            },
                            "result_view": {
                                "type": "object",
                                "description": "How to display the tool's output. Set this for structured output. Examples: {\"viewType\":\"table\",\"columns\":[{\"key\":\"name\",\"label\":\"Name\"}]} for tabular data, {\"viewType\":\"json\"} for JSON, {\"viewType\":\"markdown\"} for markdown text. If omitted, auto-detects format.",
                                "properties": {
                                    "viewType": { "type": "string", "enum": ["text", "table", "list", "json", "markdown"], "description": "Display type" },
                                    "columns": { "type": "array", "items": { "type": "object", "properties": { "key": { "type": "string" }, "label": { "type": "string" } } }, "description": "Column definitions for 'table' view" }
                                }
                            },
                            "interaction": {
                                "type": "object",
                                "description": "Interaction spec for wizard-style UI. Define steps, result actions, and streaming config.",
                                "properties": {
                                    "steps": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string", "description": "Step identifier" },
                                                "title": { "type": "string", "description": "Step title shown to user" },
                                                "description": { "type": "string", "description": "Step description" },
                                                "fields": { "type": "array", "items": { "type": "string" }, "description": "Parameter names shown in this step" },
                                                "autoAdvance": { "type": "boolean", "description": "Auto-advance to next step after filling" }
                                            },
                                            "required": ["id", "title", "fields"]
                                        }
                                    },
                                    "resultActions": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" },
                                                "label": { "type": "string" },
                                                "icon": { "type": "string" },
                                                "actionType": { "type": "string", "description": "Action type: open_file, re_run, copy_result, export" },
                                                "description": { "type": "string" }
                                            },
                                            "required": ["id", "label", "actionType"]
                                        }
                                    },
                                    "streaming": {
                                        "type": "object",
                                        "properties": {
                                            "progressPattern": { "type": "string", "description": "Regex to extract progress from output" },
                                            "statusField": { "type": "string", "description": "JSON field for status updates" },
                                            "showProgress": { "type": "boolean" }
                                        }
                                    }
                                }
                            }
                        },
                        "required": ["name", "description", "script"]
                    },
                    "description": "Tools provided by this plugin (for 'create', 'update' actions). ALWAYS add result_view for tools with structured output, and ui_* hints on parameters."
                },
                "scenarios": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "Scenario name, e.g. 'Query IP Location'" },
                            "description": { "type": "string", "description": "When and why to use this plugin in this scenario" },
                            "example_prompt": { "type": "string", "description": "Example user prompt that would trigger this scenario, e.g. 'What is the location of IP 8.8.8.8?'" }
                        },
                        "required": ["name", "description", "example_prompt"]
                    },
                    "description": "Usage scenarios for this plugin. Describe when and how users would want to use this plugin. Always provide at least one scenario when creating a plugin. (for 'create', 'update' actions)"
                },
                "trigger_keywords": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Keywords that indicate this plugin might be useful, e.g. ['ip', 'location', 'geolocation', 'where']. Always provide relevant keywords when creating a plugin. (for 'create', 'update' actions)"
                },
                "refine_feedback": {
                    "type": "string",
                    "description": "User feedback or improvement request for the plugin (for 'refine' action). Describe what needs to be improved, fixed, or added."
                },
                "patch_tools": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "Name of the existing tool to patch (must match an existing tool name)" },
                            "description": { "type": "string", "description": "New description for the tool (optional, only if changing)" },
                            "script": { "type": "string", "description": "New script for the tool (optional, only if changing)" },
                            "parameters": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": { "type": "string" },
                                        "type": { "type": "string" },
                                        "required": { "type": "boolean" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["name", "type", "required", "description"]
                                },
                                "description": "New parameters for the tool (optional, only if changing)"
                            }
                        },
                        "required": ["name"]
                    },
                    "description": "Incrementally patch specific tools without replacing all tools. Each entry patches one existing tool by name. Only specified fields are updated; omitted fields keep their current values. Use this instead of 'tools' when you only need to modify some tools. (for 'refine' action)"
                },
                "add_tools": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "Tool name (unique identifier)" },
                            "description": { "type": "string", "description": "What this tool does" },
                            "script": { "type": "string", "description": "Script that defines how to execute this tool" },
                            "parameters": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": { "type": "string" },
                                        "type": { "type": "string" },
                                        "required": { "type": "boolean" },
                                        "description": { "type": "string" }
                                    },
                                    "required": ["name", "type", "required", "description"]
                                }
                            }
                        },
                        "required": ["name", "description", "script"]
                    },
                    "description": "Add new tools to the plugin without modifying existing ones. (for 'refine' action)"
                },
                "remove_tools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Remove tools by name from the plugin. (for 'refine' action)"
                },
                "changelog_changes": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of changes made during refinement, e.g. ['Added error handling', 'Fixed URL template', 'Added new parameter']. (for 'refine' action)"
                },
                "group_id": {
                    "type": "string",
                    "description": "Plugin group ID for categorization. Available groups: 'network' (网络服务), 'dev' (开发工具), 'data' (数据分析), 'creative' (创意工具), 'utility' (实用工具). If not specified, the system will auto-infer based on plugin name and description."
                },
                "category": {
                    "type": "string",
                    "description": "Sub-category within the group, e.g. '通用', 'HTTP工具', etc. (for 'create', 'update' actions)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"].as_str()
            .ok_or_else(|| "Missing 'action' parameter".to_string())?;

        match action {
            "list" => self.action_list().await,
            "get" => self.action_get(&params).await,
            "create" => self.action_create(&params).await,
            "update" => self.action_update(&params).await,
            "delete" => self.action_delete(&params).await,
            "toggle" => self.action_toggle(&params).await,
            "list_tools" => self.action_list_tools().await,
            "test" => self.action_test(&params).await,
            "refine" => self.action_refine(&params).await,
            "analyze_usage" => self.action_analyze_usage(&params).await,
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown action '{}'. Available: list, get, create, update, delete, toggle, list_tools, test, refine", action),
                metadata: Value::Null,
            }),
        }
    }
}

impl PluginManagerTool {
    async fn action_list(&self) -> Result<ToolOutput, String> {
        let plugins = self.plugin_service.list_plugins()?;

        if plugins.is_empty() {
            return Ok(ToolOutput {
                success: true,
                result: "No plugins found. You can create one using the 'create' action.".to_string(),
                metadata: json!({ "results": [] }),
            });
        }

        let results: Vec<Value> = plugins.iter().map(|p| json!({
            "id": p.id,
            "name": p.name,
            "version": p.version,
            "description": p.description,
            "author": p.author,
            "enabled": p.enabled,
            "toolsCount": p.tools.len(),
        })).collect();

        let summary = results.iter().map(|r| {
            let status = if r["enabled"].as_bool().unwrap_or(false) { "✓" } else { "✗" };
            format!("{} {} v{} - {} ({} tool(s))", status, r["name"], r["version"], r["description"], r["toolsCount"])
        }).collect::<Vec<_>>().join("\n");

        Ok(ToolOutput {
            success: true,
            result: format!("Plugins ({}):\n{}", results.len(), summary),
            metadata: json!({ "results": results }),
        })
    }

    async fn action_get(&self, params: &Value) -> Result<ToolOutput, String> {
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter".to_string())?;

        let plugin = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        let tools_info: Vec<Value> = plugin.tools.iter().map(|t| {
            let params_info: Vec<Value> = t.parameters.iter().map(|p| json!({
                "name": p.name,
                "type": p.param_type,
                "required": p.required,
                "description": p.description,
            })).collect();
            json!({
                "name": t.name,
                "description": t.description,
                "script": t.script,
                "parameters": params_info,
            })
        }).collect();

        Ok(ToolOutput {
            success: true,
            result: format!(
                "# {} v{}\nBy: {}\n{}\nEnabled: {}\nTools ({}):\n{}{}\n{}",
                plugin.name,
                plugin.version,
                plugin.author,
                plugin.description,
                if plugin.enabled { "Yes" } else { "No" },
                plugin.tools.len(),
                tools_info.iter().map(|t| format!("  - {}: {} (script: {})", t["name"], t["description"], t["script"])).collect::<Vec<_>>().join("\n"),
                if plugin.scenarios.is_empty() { String::new() } else {
                    format!("\nScenarios ({}):\n{}", plugin.scenarios.len(),
                        plugin.scenarios.iter().map(|s| {
                            let mut sanitized = s.clone();
                            sanitized.sanitize();
                            format!("  - {}: {} (example: \"{}\")", sanitized.name, sanitized.description, sanitized.example_prompt)
                        }).collect::<Vec<_>>().join("\n"))
                },
                if plugin.trigger_keywords.is_empty() { String::new() } else {
                    format!("\nTrigger Keywords: {}", plugin.trigger_keywords.join(", "))
                }
            ),
            metadata: json!({
                "id": plugin.id,
                "name": plugin.name,
                "version": plugin.version,
                "description": plugin.description,
                "author": plugin.author,
                "enabled": plugin.enabled,
                "tools": tools_info,
                "scenarios": plugin.scenarios.iter().map(|s| {
                    let mut sanitized = s.clone();
                    sanitized.sanitize();
                    json!({
                        "name": sanitized.name,
                        "description": sanitized.description,
                        "examplePrompt": sanitized.example_prompt,
                    })
                }).collect::<Vec<_>>(),
                "triggerKeywords": plugin.trigger_keywords,
            }),
        })
    }

    async fn action_create(&self, params: &Value) -> Result<ToolOutput, String> {
        let name = params["name"].as_str()
            .ok_or_else(|| "Missing 'name' parameter for create".to_string())?;
        let description = params["description"].as_str()
            .ok_or_else(|| "Missing 'description' parameter for create".to_string())?;
        let version = params["version"].as_str().unwrap_or("1.0.0");
        let author = params["author"].as_str().unwrap_or("AI Assistant");

        let base_id = name.to_lowercase()
            .replace(' ', "-")
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
            .collect::<String>();

        let id = self.ensure_unique_id(&base_id)?;

        let tools = self.parse_tools_from_params(params)?;

        let scenarios = self.parse_scenarios_from_params(params);
        let trigger_keywords = self.parse_trigger_keywords_from_params(params);

        let conflicts = self.check_tool_name_conflicts(&tools)?;
        if !conflicts.is_empty() {
            return Ok(ToolOutput {
                success: false,
                result: format!(
                    "Cannot create plugin: tool name conflicts detected:\n{}\nPlease rename these tools. Built-in reserved names: terminal, notebook, file, command_history, terminal_session, plugin_manager.",
                    conflicts.join("\n")
                ),
                metadata: json!({ "conflicts": conflicts }),
            });
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let group_id = params["group_id"].as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| self.infer_group_id(name, description));
        let category = params["category"].as_str().unwrap_or("").to_string();

        let create_tool_changes: Vec<ToolChange> = tools.iter().map(|t| ToolChange {
            tool_name: t.name.clone(),
            field: "added".to_string(),
            before: String::new(),
            after: t.script.clone(),
        }).collect();

        let manifest = PluginManifest {
            id: id.clone(),
            name: name.to_string(),
            version: version.to_string(),
            description: description.to_string(),
            author: author.to_string(),
            enabled: true,
            tools,
            scenarios,
            trigger_keywords,
            changelog: vec![ChangelogEntry {
                version: version.to_string(),
                date: now,
                changes: vec!["Initial release".to_string()],
                tool_changes: create_tool_changes,
            }],
            group_id,
            category,
            created_at: now,
            updated_at: now,
        };

        self.plugin_service.save_plugin(&manifest)?;

        let tool_names: Vec<String> = manifest.tools.iter().map(|t| t.name.clone()).collect();

        if let (Some(registry), Some(agent_svc), Some(agent_id)) =
            (&self.tool_registry, &self.agent_service, &self.current_agent_id)
        {
            for tool_def in &manifest.tools {
                {
                    let mut reg = registry.lock().await;
                    let agent_tool = PluginAgentTool::new(tool_def.clone(), self.workspace_dir.clone())
                        .with_logging(self.plugin_service.clone(), manifest.id.clone());
                    reg.register(Arc::new(agent_tool));
                }
            }

            if let Ok(mut agents) = agent_svc.list_agents() {
                if let Some(agent) = agents.iter_mut().find(|a| a.id == *agent_id) {
                    for tool_name in &tool_names {
                        if !agent.tool_ids.is_empty() && !agent.tool_ids.contains(tool_name) {
                            agent.tool_ids.push(tool_name.clone());
                        }
                    }
                    if let Err(e) = agent_svc.save_agent(agent.clone()) {
                        tracing::warn!("[plugin_manager] action_create: failed to save agent '{}': {}", agent.id, e);
                    }
                }
            }
        }

        let test_hints: Vec<String> = manifest.tools.iter().map(|t| {
            let param_hints: Vec<String> = t.parameters.iter()
                .filter(|p| p.required)
                .map(|p| format!("\"{}\": \"<{}>\"", p.name, p.description))
                .collect();
            format!("  - test tool '{}': action='test', plugin_id='{}', tool_name='{}', test_params={{ {} }}",
                t.name, manifest.id, t.name, param_hints.join(", "))
        }).collect();

        Ok(ToolOutput {
            success: true,
            result: format!(
                "Created plugin '{}' (id: {}) v{} with {} tool(s): {}. The plugin is enabled and its tools have been automatically added to the current agent.\n\n\
                 IMPORTANT: You MUST now test each tool to verify it works correctly. Use the 'test' action:\n{}\n\n\
                 If any test fails, use 'refine' with patch_tools to fix the issue, then test again.",
                manifest.name, manifest.id, manifest.version, manifest.tools.len(), tool_names.join(", "),
                test_hints.join("\n")
            ),
            metadata: json!({
                "id": manifest.id,
                "name": manifest.name,
                "version": manifest.version,
                "enabled": manifest.enabled,
                "toolsCount": manifest.tools.len(),
                "toolNames": tool_names,
                "nextStep": "test",
                "testCommands": test_hints,
            }),
        })
    }

    async fn action_update(&self, params: &Value) -> Result<ToolOutput, String> {
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter for update".to_string())?;

        let mut existing = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        let old_tool_names: Vec<String> = existing.tools.iter().map(|t| t.name.clone()).collect();

        if let Some(name) = params["name"].as_str() {
            existing.name = name.to_string();
        }
        if let Some(desc) = params["description"].as_str() {
            existing.description = desc.to_string();
        }
        if let Some(version) = params["version"].as_str() {
            existing.version = version.to_string();
        }
        if let Some(author) = params["author"].as_str() {
            existing.author = author.to_string();
        }
        if params["tools"].is_array() {
            existing.tools = self.parse_tools_from_params(params)?;
        }

        if let Some(patch_arr) = params["patch_tools"].as_array() {
            for patch in patch_arr {
                let target_name = patch["name"].as_str()
                    .ok_or_else(|| "Each patch_tools entry must have a 'name'".to_string())?;
                if let Some(tool) = existing.tools.iter_mut().find(|t| t.name == target_name) {
                    if let Some(desc) = patch["description"].as_str() {
                        tool.description = desc.to_string();
                    }
                    if let Some(script) = patch["script"].as_str() {
                        tool.script = script.to_string();
                    }
                    if let Some(params_arr) = patch["parameters"].as_array() {
                        tool.parameters = self.parse_single_tool_parameters(params_arr)?;
                    }
                } else {
                    return Err(format!("Cannot patch tool '{}': tool not found in plugin. Existing tools: {}", target_name, existing.tools.iter().map(|t| t.name.clone()).collect::<Vec<_>>().join(", ")));
                }
            }
        }

        if let Some(add_arr) = params["add_tools"].as_array() {
            for add_tool in add_arr {
                let name = add_tool["name"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'name'".to_string())?;
                if existing.tools.iter().any(|t| t.name == name) {
                    return Err(format!("Cannot add tool '{}': a tool with this name already exists in the plugin. Use patch_tools instead.", name));
                }
                let description = add_tool["description"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'description'".to_string())?;
                let script = add_tool["script"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'script'".to_string())?;
                let add_params = if let Some(params_arr) = add_tool["parameters"].as_array() {
                    self.parse_single_tool_parameters(params_arr)?
                } else {
                    Vec::new()
                };
                let mut add_ui_schema = if add_params.is_empty() {
                    None
                } else {
                    Some(UiSchema::from_tool_parameters(&add_params))
                };
                if let Some(interaction_val) = add_tool.get("interaction") {
                    if let Some(ref mut schema) = add_ui_schema {
                        if let Ok(interaction) = serde_json::from_value::<crate::plugins::domain::ui_schema::InteractionSpec>(interaction_val.clone()) {
                            *schema = schema.clone().with_interaction(interaction);
                        }
                    }
                }
                let add_result_view = add_tool.get("result_view")
                    .and_then(|v| serde_json::from_value::<crate::plugins::domain::ui_schema::ResultViewSpec>(v.clone()).ok());
                existing.tools.push(PluginTool {
                    name: name.to_string(),
                    description: description.to_string(),
                    script: script.to_string(),
                    parameters: add_params,
                    ui_schema: add_ui_schema,
                    result_view: add_result_view,
                });
            }
        }

        if let Some(remove_arr) = params["remove_tools"].as_array() {
            let names_to_remove: Vec<String> = remove_arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            for name in &names_to_remove {
                if !existing.tools.iter().any(|t| &t.name == name) {
                    return Err(format!("Cannot remove tool '{}': tool not found in plugin.", name));
                }
            }
            existing.tools.retain(|t| !names_to_remove.contains(&t.name));
        }
        if params["scenarios"].is_array() {
            existing.scenarios = self.parse_scenarios_from_params(params);
        }
        if params["trigger_keywords"].is_array() {
            existing.trigger_keywords = self.parse_trigger_keywords_from_params(params);
        }

        existing.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        self.plugin_service.save_plugin(&existing)?;

        let new_tool_names: Vec<String> = existing.tools.iter().map(|t| t.name.clone()).collect();

        if let Some(registry) = &self.tool_registry {
            let mut reg = registry.lock().await;
            for name in &old_tool_names {
                reg.unregister(name);
            }
            for tool_def in &existing.tools {
                let agent_tool = PluginAgentTool::new(tool_def.clone(), self.workspace_dir.clone())
                    .with_logging(self.plugin_service.clone(), existing.id.clone());
                reg.register(Arc::new(agent_tool));
            }
            tracing::info!("[plugin_manager] action_refine: registry updated, new_tool_count={}", existing.tools.len());
        }

        let removed_tool_names: Vec<String> = old_tool_names.iter()
            .filter(|name| !new_tool_names.contains(name))
            .cloned()
            .collect();

        if let (Some(agent_svc), Some(current_id)) = (&self.agent_service, &self.current_agent_id) {
            tracing::info!("[plugin_manager] action_refine: updating agent tool_ids, current_agent_id={}", current_id);
            if let Ok(mut agents) = agent_svc.list_agents() {
                for agent in &mut agents {
                    let before_len = agent.tool_ids.len();
                    let before_allowed = agent.always_allowed_tools.len();
                    // Remove old tool names from ALL agents
                    for name in &old_tool_names {
                        agent.tool_ids.retain(|t| t != name);
                    }
                    // Clean up always_allowed_tools for removed/renamed tools
                    for name in &removed_tool_names {
                        agent.always_allowed_tools.retain(|t| t != name);
                    }
                    // Add new tool names only to the current agent
                    if agent.id == *current_id {
                        for name in &new_tool_names {
                            if !agent.tool_ids.is_empty() && !agent.tool_ids.contains(name) {
                                agent.tool_ids.push(name.clone());
                            }
                        }
                    }
                    if agent.tool_ids.len() != before_len || agent.always_allowed_tools.len() != before_allowed {
                        if let Err(e) = agent_svc.save_agent(agent.clone()) {
                            tracing::warn!("[plugin_manager] action_update: failed to save agent '{}': {}", agent.id, e);
                        }
                    }
                }
            }
        }

        Ok(ToolOutput {
            success: true,
            result: format!("Updated plugin '{}' (id: {}). Tool definitions have been refreshed in the current session.", existing.name, existing.id),
            metadata: json!({
                "id": existing.id,
                "name": existing.name,
                "version": existing.version,
                "toolNames": new_tool_names,
            }),
        })
    }

    async fn action_delete(&self, params: &Value) -> Result<ToolOutput, String> {
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter for delete".to_string())?;

        let existing = self.plugin_service.get_plugin(plugin_id)?;

        let deleted_tool_names: Vec<String> = existing.as_ref()
            .map(|p| p.tools.iter().map(|t| t.name.clone()).collect())
            .unwrap_or_default();

        self.plugin_service.delete_plugin(plugin_id)?;

        if let Some(registry) = &self.tool_registry {
            let mut reg = registry.lock().await;
            for tool_name in &deleted_tool_names {
                reg.unregister(tool_name);
            }
        }

        if let (Some(agent_svc), Some(_agent_id)) = (&self.agent_service, &self.current_agent_id) {
            if !deleted_tool_names.is_empty() {
                if let Ok(mut agents) = agent_svc.list_agents() {
                    for agent in &mut agents {
                        let before_len = agent.tool_ids.len();
                        for tool_name in &deleted_tool_names {
                            agent.tool_ids.retain(|t| t != tool_name);
                        }
                        let before_allowed = agent.always_allowed_tools.len();
                        for tool_name in &deleted_tool_names {
                            agent.always_allowed_tools.retain(|t| t != tool_name);
                        }
                        if agent.tool_ids.len() != before_len || agent.always_allowed_tools.len() != before_allowed {
                            if let Err(e) = agent_svc.save_agent(agent.clone()) {
                                tracing::warn!("[plugin_manager] action_delete: failed to save agent '{}': {}", agent.id, e);
                            }
                        }
                    }
                }
            }
        }

        // Always clean up empty groups/categories after deletion,
        // regardless of whether agent_service is available or any agent was modified
        if let Err(e) = self.plugin_service.cleanup_empty_groups_and_categories() {
            tracing::warn!("[plugin_manager] action_delete: cleanup_empty_groups failed: {}", e);
        }

        let name = existing.as_ref().map(|p| p.name.as_str()).unwrap_or(plugin_id);

        Ok(ToolOutput {
            success: true,
            result: format!("Deleted plugin '{}' (id: {}). Removed {} tool(s) from the current session.", name, plugin_id, deleted_tool_names.len()),
            metadata: json!({ "id": plugin_id, "deletedTools": deleted_tool_names }),
        })
    }

    async fn action_toggle(&self, params: &Value) -> Result<ToolOutput, String> {
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter for toggle".to_string())?;
        let enabled = params["enabled"].as_bool()
            .ok_or_else(|| "Missing 'enabled' parameter for toggle".to_string())?;

        self.plugin_service.toggle_plugin(plugin_id, enabled)?;

        let plugin = self.plugin_service.get_plugin(plugin_id)?;

        Ok(ToolOutput {
            success: true,
            result: format!("Plugin '{}' is now {}", plugin_id, if enabled { "enabled" } else { "disabled" }),
            metadata: json!({
                "id": plugin_id,
                "enabled": enabled,
                "name": plugin.map(|p| p.name).unwrap_or_default(),
            }),
        })
    }

    async fn action_list_tools(&self) -> Result<ToolOutput, String> {
        let tools = self.plugin_service.list_enabled_tools()?;

        if tools.is_empty() {
            return Ok(ToolOutput {
                success: true,
                result: "No tools available from enabled plugins.".to_string(),
                metadata: json!({ "results": [] }),
            });
        }

        let results: Vec<Value> = tools.iter().map(|t| json!({
            "name": t.name,
            "description": t.description,
            "script": t.script,
            "paramCount": t.parameters.len(),
        })).collect();

        let summary = results.iter().map(|r| {
            format!("- {}: {} ({} param(s))", r["name"], r["description"], r["paramCount"])
        }).collect::<Vec<_>>().join("\n");

        Ok(ToolOutput {
            success: true,
            result: format!("Available plugin tools ({}):\n{}", results.len(), summary),
            metadata: json!({ "results": results }),
        })
    }

    async fn action_test(&self, params: &Value) -> Result<ToolOutput, String> {
        let tool_name = params["tool_name"].as_str()
            .ok_or_else(|| "Missing 'tool_name' parameter for test action".to_string())?;

        let test_params = params.get("test_params").cloned().unwrap_or(json!({}));

        let all_tools = self.plugin_service.list_enabled_tools()?;
        let tool_def = all_tools.iter().find(|t| t.name == tool_name)
            .ok_or_else(|| {
                let available: Vec<String> = all_tools.iter().map(|t| t.name.clone()).collect();
                format!("Tool '{}' not found in enabled plugins. Available tools: {}", tool_name, available.join(", "))
            })?;

        let missing_required: Vec<String> = tool_def.parameters.iter()
            .filter(|p| p.required)
            .filter(|p| {
                let val = test_params.get(&p.name);
                val.is_none() || val.map(|v| v.is_null()).unwrap_or(true)
            })
            .map(|p| format!("{} ({})", p.name, p.description))
            .collect();

        if !missing_required.is_empty() {
            return Ok(ToolOutput {
                success: false,
                result: format!(
                    "❌ Tool '{}' test FAILED: Missing required parameters: {}.\n\nPlease provide test_params with all required parameters. Example:\ntest_params: {{ {} }}",
                    tool_name,
                    missing_required.join(", "),
                    tool_def.parameters.iter()
                        .filter(|p| p.required)
                        .map(|p| format!("\"{}\": \"<{}>\"", p.name, p.description))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                metadata: json!({
                    "tool": tool_name,
                    "error_type": "missing_required_params",
                    "missing_params": missing_required,
                }),
            });
        }

        let plugin_tool = PluginAgentTool::new(tool_def.clone(), self.workspace_dir.clone());
        let result = plugin_tool.execute(test_params).await;

        match result {
            Ok(output) => {
                if output.success {
                    Ok(ToolOutput {
                        success: true,
                        result: format!("✅ Tool '{}' test PASSED.\n\nOutput:\n{}\n\nThe tool is working correctly.", tool_name, output.result),
                        metadata: output.metadata,
                    })
                } else {
                    let diagnosis = self.diagnose_tool_failure(tool_name, &output.result, &tool_def.script);
                    Ok(ToolOutput {
                        success: false,
                        result: format!("❌ Tool '{}' test FAILED.\n\nError:\n{}\n\n{}", tool_name, output.result, diagnosis),
                        metadata: output.metadata,
                    })
                }
            }
            Err(e) => {
                let diagnosis = self.diagnose_tool_failure(tool_name, &e, &tool_def.script);
                Ok(ToolOutput {
                    success: false,
                    result: format!("❌ Tool '{}' test FAILED with exception.\n\nError: {}\n\n{}", tool_name, e, diagnosis),
                    metadata: json!({ "tool": tool_name, "error": e }),
                })
            }
        }
    }

    fn diagnose_tool_failure(&self, _tool_name: &str, error: &str, script: &str) -> String {
        let mut suggestions = Vec::new();

        if error.contains("ModuleNotFoundError") || error.contains("ImportError") || error.contains("No module named") {
            suggestions.push("A Python dependency is missing. Solutions:".to_string());
            suggestions.push("  1. Install the dependency: pip install <package>".to_string());
            suggestions.push("  2. Modify the script to use 'script:python3' format and add pip install at the top".to_string());
            suggestions.push("  3. Use the 'refine' action to update the tool script with proper dependency handling".to_string());
        }

        if error.contains("SyntaxError") || error.contains("syntax error") {
            if script.starts_with("shell:") && (script.contains("python3 -c") || script.contains("python -c")) {
                suggestions.push("The script uses 'shell: python3 -c \"...\"' which has escaping issues for complex code.".to_string());
                suggestions.push("SOLUTION: Use 'script:python3' format instead for multi-line Python scripts.".to_string());
                suggestions.push("Example: script:python3\\nimport json\\n# your code here".to_string());
            } else {
                suggestions.push("There is a syntax error in the script. Check for:".to_string());
                suggestions.push("  - Missing quotes, parentheses, or indentation".to_string());
                suggestions.push("  - Incorrect escape sequences in shell commands".to_string());
                suggestions.push("  - Use 'refine' action to fix the script".to_string());
            }
        }

        if error.contains("command not found") || error.contains("not recognized") {
            suggestions.push("The interpreter or command is not installed on this system.".to_string());
            suggestions.push("  1. Install the required program (e.g., python3, node)".to_string());
            suggestions.push("  2. Or modify the script to use an available interpreter".to_string());
        }

        if error.contains("timeout") || error.contains("timed out") {
            suggestions.push("The script execution timed out. Solutions:".to_string());
            suggestions.push("  1. Simplify the script to reduce execution time".to_string());
            suggestions.push("  2. Process smaller chunks of data".to_string());
            suggestions.push("  3. Use the 'refine' action to increase the timeout setting".to_string());
        }

        if error.contains("No such file") || error.contains("not found") && !error.contains("command not found") {
            suggestions.push("A file path referenced in the script does not exist.".to_string());
            suggestions.push("  1. Check that the input file path is correct".to_string());
            suggestions.push("  2. Use relative paths or workspace-relative paths".to_string());
            suggestions.push("  3. The {{workspace_dir}} variable resolves to the agent's workspace directory".to_string());
        }

        if error.contains("Is a directory") || error.contains("[Errno 21]") {
            suggestions.push("The script is trying to write to a directory path instead of a file path.".to_string());
            suggestions.push("  ROOT CAUSE: {{output_path}} / {{workspace_dir}} resolves to a DIRECTORY, not a file.".to_string());
            suggestions.push("  FIX: When writing files, ALWAYS append a filename after {{workspace_dir}}:".to_string());
            suggestions.push("    WRONG: open('{{workspace_dir}}', 'w')".to_string());
            suggestions.push("    RIGHT: open('{{workspace_dir}}/result.json', 'w')".to_string());
            suggestions.push("  Use 'refine' with patch_tools to fix the script, then 'test' again.".to_string());
        }

        if error.contains("Permission denied") {
            suggestions.push("The script does not have permission to access the file or directory.".to_string());
            suggestions.push("  1. Check file/directory permissions".to_string());
            suggestions.push("  2. Try using a different output path within {{workspace_dir}}".to_string());
        }

        if error.contains("NameError") || error.contains("name '") && error.contains("' is not defined") {
            suggestions.push("The script references a variable or function that is not defined.".to_string());
            suggestions.push("  1. Check for missing import statements (e.g. import json, import os)".to_string());
            suggestions.push("  2. Check for typos in variable names".to_string());
            suggestions.push("  3. Make sure all variables are defined before use".to_string());
        }

        if error.contains("UnicodeDecodeError") || error.contains("UnicodeEncodeError") || error.contains("'ascii' codec") {
            suggestions.push("The script has an encoding issue, likely with non-ASCII characters (e.g. Chinese text).".to_string());
            suggestions.push("  FIX for Python: Add encoding='utf-8' to all open() calls:".to_string());
            suggestions.push("    WRONG: open('{{input_path}}', 'r')".to_string());
            suggestions.push("    RIGHT: open('{{input_path}}', 'r', encoding='utf-8')".to_string());
            suggestions.push("  Also add at the top of your script: import sys; sys.stdout.reconfigure(encoding='utf-8')".to_string());
        }

        if error.contains("produced NO OUTPUT") || error.contains("No stdout output") {
            suggestions.push("The script completed but did not print any results to stdout.".to_string());
            suggestions.push("  1. Make sure you use print() to output results (not just write to a file)".to_string());
            suggestions.push("  2. For JSON output: print(json.dumps(result, ensure_ascii=False))".to_string());
            suggestions.push("  3. Check that your script doesn't only write to files but also prints to stdout".to_string());
        }

        if error.contains("unresolved parameter placeholders") {
            suggestions.push("The script contains {{param_name}} placeholders that were not replaced with actual values.".to_string());
            suggestions.push("  1. Make sure all required parameters are provided in test_params".to_string());
            suggestions.push("  2. Check parameter names match exactly (case-sensitive)".to_string());
            suggestions.push("  3. Use 'refine' to add default values for optional parameters".to_string());
        }

        if error.contains("JSONDecodeError") || error.contains("json.decoder") || error.contains("Unexpected token") {
            suggestions.push("The script is trying to parse invalid JSON data.".to_string());
            suggestions.push("  1. Validate the input JSON before parsing".to_string());
            suggestions.push("  2. Use try/except around json.loads()".to_string());
            suggestions.push("  3. Print the raw data first to debug: print(repr(data))".to_string());
        }

        if error.contains("ConnectionError") || error.contains("Connection refused") || error.contains("Failed to resolve") {
            suggestions.push("The script cannot connect to a network service.".to_string());
            suggestions.push("  1. Check the URL is correct and accessible".to_string());
            suggestions.push("  2. The service may be down or blocking requests".to_string());
            suggestions.push("  3. Add retry logic and timeout handling".to_string());
        }

        if error.contains("Cannot find module") || error.contains("MODULE_NOT_FOUND") {
            suggestions.push("A Node.js module is missing.".to_string());
            suggestions.push("  1. Install the module: npm install <package>".to_string());
            suggestions.push("  2. Or use 'script:node' format and add require() with try/catch".to_string());
        }

        if suggestions.is_empty() {
            format!("Suggestion: Use the 'get' action to review the plugin code, then use 'refine' to fix the issue and 'test' again to verify.")
        } else {
            format!("Diagnosis:\n{}", suggestions.join("\n"))
        }
    }

    fn ensure_unique_id(&self, base_id: &str) -> Result<String, String> {
        let existing = self.plugin_service.list_plugins()?;
        let existing_ids: Vec<String> = existing.iter().map(|p| p.id.clone()).collect();

        if !existing_ids.contains(&base_id.to_string()) {
            return Ok(base_id.to_string());
        }

        for i in 2..100 {
            let candidate = format!("{}-{}", base_id, i);
            if !existing_ids.contains(&candidate) {
                return Ok(candidate);
            }
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Ok(format!("{}-{}", base_id, timestamp))
    }

    fn parse_tools_from_params(&self, params: &Value) -> Result<Vec<PluginTool>, String> {
        let tools_array = match params["tools"].as_array() {
            Some(arr) if !arr.is_empty() => arr,
            _ => return Ok(Vec::new()),
        };

        let mut tools = Vec::new();
        for tool_val in tools_array {
            let name = tool_val["name"].as_str()
                .ok_or_else(|| "Each tool must have a 'name'".to_string())?;
            let description = tool_val["description"].as_str()
                .ok_or_else(|| "Each tool must have a 'description'".to_string())?;
            let script = tool_val["script"].as_str()
                .ok_or_else(|| "Each tool must have a 'script'".to_string())?;

            let mut parameters = Vec::new();
            if let Some(params_arr) = tool_val["parameters"].as_array() {
                parameters = self.parse_single_tool_parameters(params_arr)?;
            }

            let mut ui_schema = if parameters.is_empty() {
                None
            } else {
                Some(UiSchema::from_tool_parameters(&parameters))
            };

            if let Some(interaction_val) = tool_val.get("interaction") {
                if let Some(ref mut schema) = ui_schema {
                    if let Ok(interaction) = serde_json::from_value::<crate::plugins::domain::ui_schema::InteractionSpec>(interaction_val.clone()) {
                        *schema = schema.clone().with_interaction(interaction);
                    }
                }
            }

            let result_view = tool_val.get("result_view")
                .and_then(|v| serde_json::from_value::<crate::plugins::domain::ui_schema::ResultViewSpec>(v.clone()).ok());

            tools.push(PluginTool {
                name: name.to_string(),
                description: description.to_string(),
                parameters,
                script: script.to_string(),
                ui_schema,
                result_view,
            });
        }

        Ok(tools)
    }

    fn parse_single_tool_parameters(&self, params_arr: &[Value]) -> Result<Vec<ToolParameter>, String> {
        let mut parameters = Vec::new();
        for (idx, param_val) in params_arr.iter().enumerate() {
            let param_name = param_val["name"].as_str().unwrap_or("").to_string();
            let param_type = param_val["param_type"].as_str().or_else(|| param_val["type"].as_str()).unwrap_or("string").to_string();
            let required = param_val["required"].as_bool().unwrap_or(false);
            let param_desc = param_val["description"].as_str().unwrap_or("").to_string();
            let default_value = param_val.get("default_value").cloned();

            parameters.push(ToolParameter {
                name: param_name,
                param_type,
                required,
                description: param_desc,
                default_value,
                ui_widget: param_val["ui_widget"].as_str().map(|s| s.to_string()),
                ui_label: param_val["ui_label"].as_str().map(|s| s.to_string()),
                ui_placeholder: param_val["ui_placeholder"].as_str().map(|s| s.to_string()),
                ui_options: param_val["ui_options"].as_array().map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()),
                ui_accept: param_val["ui_accept"].as_str().map(|s| s.to_string()),
                ui_group: param_val["ui_group"].as_str().map(|s| s.to_string()),
                ui_order: param_val["ui_order"].as_u64().map(|v| v as u32).or(Some(idx as u32)),
            });
        }
        Ok(parameters)
    }

    fn check_tool_name_conflicts(&self, new_tools: &[PluginTool]) -> Result<Vec<String>, String> {
        let reserved_names = [
            "terminal", "notebook", "file", "command_history",
            "terminal_session", "plugin_manager",
        ];

        let existing_tools = self.plugin_service.list_enabled_tools()?;
        let existing_names: Vec<&str> = existing_tools.iter().map(|t| t.name.as_str()).collect();

        let mut conflicts = Vec::new();

        for tool in new_tools {
            if reserved_names.contains(&tool.name.as_str()) {
                conflicts.push(format!(
                    "- '{}' conflicts with a built-in tool (reserved: {})",
                    tool.name,
                    reserved_names.join(", ")
                ));
            } else if existing_names.contains(&tool.name.as_str()) {
                conflicts.push(format!(
                    "- '{}' conflicts with an existing plugin tool",
                    tool.name
                ));
            }
        }

        let new_names: Vec<&str> = new_tools.iter().map(|t| t.name.as_str()).collect();
        let mut seen = std::collections::HashSet::new();
        for name in &new_names {
            if !seen.insert(*name) {
                conflicts.push(format!(
                    "- '{}' appears more than once within the same plugin",
                    name
                ));
            }
        }

        Ok(conflicts)
    }

    fn parse_scenarios_from_params(&self, params: &Value) -> Vec<PluginScenario> {
        let scenarios_array = match params["scenarios"].as_array() {
            Some(arr) => arr,
            None => return Vec::new(),
        };

        let mut scenarios = Vec::new();
        for scenario_val in scenarios_array {
            let name = scenario_val["name"].as_str().unwrap_or("").to_string();
            let description = scenario_val["description"].as_str().unwrap_or("").to_string();
            let example_prompt = scenario_val["example_prompt"].as_str().unwrap_or("").to_string();
            let category = scenario_val["category"].as_str().unwrap_or("practical").to_string();
            let tool_name = scenario_val["tool_name"].as_str().unwrap_or("").to_string();

            if !name.is_empty() {
                let mut scenario = PluginScenario {
                    name,
                    description,
                    example_prompt,
                    category,
                    tool_name,
                };
                // Sanitize scenarios before saving to prevent system instructions and
                // absolute paths from being persisted to the manifest file
                scenario.sanitize();
                scenarios.push(scenario);
            }
        }

        scenarios
    }

    fn parse_trigger_keywords_from_params(&self, params: &Value) -> Vec<String> {
        match params["trigger_keywords"].as_array() {
            Some(arr) => arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect(),
            None => Vec::new(),
        }
    }

    async fn action_refine(&self, params: &Value) -> Result<ToolOutput, String> {
        tracing::info!("[plugin_manager] action_refine called, params keys: {:?}", params.as_object().map(|o| o.keys().collect::<Vec<_>>()));
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter for refine".to_string())?;
        tracing::info!("[plugin_manager] action_refine: plugin_id={}", plugin_id);

        let mut existing = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        let metrics = self.plugin_service.get_usage_metrics(plugin_id).ok();
        let fail_rate = metrics.as_ref().map(|m| {
            if m.total_executions > 0 { m.fail_count as f64 / m.total_executions as f64 } else { 0.0 }
        }).unwrap_or(0.0);

        let mut usage_context = String::new();
        if let Some(ref m) = metrics {
            if m.total_executions > 0 {
                usage_context = format!(
                    "\n\n## Usage Context (auto-injected)\n- Total executions: {}\n- Success: {}\n- Failures: {}\n- Failure rate: {:.1}%\n- Avg duration: {:.0}ms\n",
                    m.total_executions, m.success_count, m.fail_count, fail_rate * 100.0, m.avg_duration_ms
                );
                if fail_rate > 0.2 {
                    let common_errors = self.plugin_service.get_common_errors(plugin_id, 3).unwrap_or_default();
                    if !common_errors.is_empty() {
                        usage_context.push_str("\n### Top Errors:\n");
                        for (i, err) in common_errors.iter().enumerate() {
                            usage_context.push_str(&format!("{}. {}\n", i + 1, err));
                        }
                    }
                    usage_context.push_str("\n⚠️ This plugin has a HIGH failure rate. Focus your refinement on fixing the errors above.\n");
                }
            }
        }

        let old_tool_names: Vec<String> = existing.tools.iter().map(|t| t.name.clone()).collect();

        let old_tools_snapshot: Vec<(String, String, String)> = existing.tools.iter()
            .map(|t| (t.name.clone(), t.description.clone(), t.script.clone()))
            .collect();

        if let Some(name) = params["name"].as_str() {
            existing.name = name.to_string();
        }
        if let Some(desc) = params["description"].as_str() {
            existing.description = desc.to_string();
        }
        if let Some(version) = params["version"].as_str() {
            existing.version = version.to_string();
        }
        if let Some(author) = params["author"].as_str() {
            existing.author = author.to_string();
        }
        if params["tools"].is_array() {
            existing.tools = self.parse_tools_from_params(params)?;
        }

        if let Some(patch_arr) = params["patch_tools"].as_array() {
            for patch in patch_arr {
                let target_name = patch["name"].as_str()
                    .ok_or_else(|| "Each patch_tools entry must have a 'name'".to_string())?;
                if let Some(tool) = existing.tools.iter_mut().find(|t| t.name == target_name) {
                    if let Some(desc) = patch["description"].as_str() {
                        tool.description = desc.to_string();
                    }
                    if let Some(script) = patch["script"].as_str() {
                        tool.script = script.to_string();
                    }
                    if let Some(params_arr) = patch["parameters"].as_array() {
                        tool.parameters = self.parse_single_tool_parameters(params_arr)?;
                    }
                } else {
                    return Err(format!("Cannot patch tool '{}': tool not found in plugin. Existing tools: {}", target_name, existing.tools.iter().map(|t| t.name.clone()).collect::<Vec<_>>().join(", ")));
                }
            }
        }

        if let Some(add_arr) = params["add_tools"].as_array() {
            for add_tool in add_arr {
                let name = add_tool["name"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'name'".to_string())?;
                if existing.tools.iter().any(|t| t.name == name) {
                    return Err(format!("Cannot add tool '{}': a tool with this name already exists in the plugin. Use patch_tools instead.", name));
                }
                let description = add_tool["description"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'description'".to_string())?;
                let script = add_tool["script"].as_str()
                    .ok_or_else(|| "Each add_tools entry must have a 'script'".to_string())?;
                let refine_params = if let Some(params_arr) = add_tool["parameters"].as_array() {
                    self.parse_single_tool_parameters(params_arr)?
                } else {
                    Vec::new()
                };
                let refine_ui_schema = if refine_params.is_empty() {
                    None
                } else {
                    Some(UiSchema::from_tool_parameters(&refine_params))
                };
                existing.tools.push(PluginTool {
                    name: name.to_string(),
                    description: description.to_string(),
                    script: script.to_string(),
                    parameters: refine_params,
                    ui_schema: refine_ui_schema,
                    result_view: None,
                });
            }
        }

        if let Some(remove_arr) = params["remove_tools"].as_array() {
            let names_to_remove: Vec<String> = remove_arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            for name in &names_to_remove {
                if !existing.tools.iter().any(|t| &t.name == name) {
                    return Err(format!("Cannot remove tool '{}': tool not found in plugin.", name));
                }
            }
            existing.tools.retain(|t| !names_to_remove.contains(&t.name));
        }

        if params["scenarios"].is_array() {
            existing.scenarios = self.parse_scenarios_from_params(params);
        }
        if params["trigger_keywords"].is_array() {
            existing.trigger_keywords = self.parse_trigger_keywords_from_params(params);
        }

        let mut tool_changes: Vec<ToolChange> = Vec::new();

        for new_tool in &existing.tools {
            if let Some(old) = old_tools_snapshot.iter().find(|(name, _, _)| name == &new_tool.name) {
                if old.2 != new_tool.script {
                    tool_changes.push(ToolChange {
                        tool_name: new_tool.name.clone(),
                        field: "script".to_string(),
                        before: old.2.clone(),
                        after: new_tool.script.clone(),
                    });
                }
                if old.1 != new_tool.description {
                    tool_changes.push(ToolChange {
                        tool_name: new_tool.name.clone(),
                        field: "description".to_string(),
                        before: old.1.clone(),
                        after: new_tool.description.clone(),
                    });
                }
            }
        }

        for old in &old_tools_snapshot {
            if !existing.tools.iter().any(|t| t.name == old.0) {
                tool_changes.push(ToolChange {
                    tool_name: old.0.clone(),
                    field: "removed".to_string(),
                    before: old.2.clone(),
                    after: String::new(),
                });
            }
        }

        for new_tool in &existing.tools {
            if !old_tools_snapshot.iter().any(|(name, _, _)| name == &new_tool.name) {
                tool_changes.push(ToolChange {
                    tool_name: new_tool.name.clone(),
                    field: "added".to_string(),
                    before: String::new(),
                    after: new_tool.script.clone(),
                });
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let changelog_changes: Vec<String> = match params["changelog_changes"].as_array() {
            Some(arr) => arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect(),
            None => vec!["Plugin refined based on feedback".to_string()],
        };

        let tool_changes_count = tool_changes.len();
        existing.changelog.push(ChangelogEntry {
            version: existing.version.clone(),
            date: now,
            changes: changelog_changes,
            tool_changes,
        });

        existing.updated_at = now;

        tracing::info!("[plugin_manager] action_refine: saving plugin, tool_changes={}", tool_changes_count);
        self.plugin_service.save_plugin(&existing)?;
        tracing::info!("[plugin_manager] action_refine: plugin saved, updating registry");

        let new_tool_names: Vec<String> = existing.tools.iter().map(|t| t.name.clone()).collect();

        if let Some(registry) = &self.tool_registry {
            tracing::info!("[plugin_manager] action_refine: acquiring registry lock");
            let mut reg = registry.lock().await;
            tracing::info!("[plugin_manager] action_refine: registry lock acquired, unregistering old tools");
            for name in &old_tool_names {
                reg.unregister(name);
            }
            for tool_def in &existing.tools {
                let agent_tool = PluginAgentTool::new(tool_def.clone(), self.workspace_dir.clone())
                    .with_logging(self.plugin_service.clone(), existing.id.clone());
                reg.register(Arc::new(agent_tool));
            }
        }

        // Remove old tool names from ALL agents (stale tool_ids and always_allowed_tools)
        // Add new tool names ONLY to the current agent
        let removed_tool_names: Vec<String> = old_tool_names.iter()
            .filter(|name| !new_tool_names.contains(name))
            .cloned()
            .collect();

        if let (Some(agent_svc), Some(current_id)) = (&self.agent_service, &self.current_agent_id) {
            if let Ok(mut agents) = agent_svc.list_agents() {
                for agent in &mut agents {
                    let before_len = agent.tool_ids.len();
                    let before_allowed = agent.always_allowed_tools.len();
                    // Remove old tool names from ALL agents
                    for name in &old_tool_names {
                        agent.tool_ids.retain(|t| t != name);
                    }
                    // Clean up always_allowed_tools for removed/renamed tools
                    for name in &removed_tool_names {
                        agent.always_allowed_tools.retain(|t| t != name);
                    }
                    // Add new tool names only to the current agent
                    if agent.id == *current_id {
                        for name in &new_tool_names {
                            if !agent.tool_ids.is_empty() && !agent.tool_ids.contains(name) {
                                agent.tool_ids.push(name.clone());
                            }
                        }
                    }
                    if agent.tool_ids.len() != before_len || agent.always_allowed_tools.len() != before_allowed {
                        if let Err(e) = agent_svc.save_agent(agent.clone()) {
                            tracing::warn!("[plugin_manager] action_refine: failed to save agent '{}': {}", agent.id, e);
                        }
                    }
                }
            }
        }

        let test_hints: Vec<String> = existing.tools.iter().map(|t| {
            let param_hints: Vec<String> = t.parameters.iter()
                .filter(|p| p.required)
                .map(|p| format!("\"{}\": \"<{}>\"", p.name, p.description))
                .collect();
            format!("  - test tool '{}': action='test', plugin_id='{}', tool_name='{}', test_params={{ {} }}",
                t.name, existing.id, t.name, param_hints.join(", "))
        }).collect();

        tracing::info!("[plugin_manager] action_refine: completed successfully, plugin={}, version={}", existing.name, existing.version);

        Ok(ToolOutput {
            success: true,
            result: format!(
                "Refined plugin '{}' (id: {}) to v{}. Changelog entry added. Tool definitions have been refreshed in the current session.{}\n\n\
                 IMPORTANT: You MUST now test the modified tools to verify they work correctly. Use the 'test' action:\n{}\n\n\
                 If any test fails, use 'refine' with patch_tools to fix the issue, then test again.",
                existing.name, existing.id, existing.version, usage_context,
                test_hints.join("\n")
            ),
            metadata: json!({
                "id": existing.id,
                "name": existing.name,
                "version": existing.version,
                "toolNames": new_tool_names,
                "failRate": fail_rate,
                "nextStep": "test",
                "testCommands": test_hints,
                "changelogEntry": {
                    "version": existing.version,
                    "changes": existing.changelog.last().map(|e| e.changes.clone()).unwrap_or_default(),
                },
            }),
        })
    }

    async fn action_analyze_usage(&self, params: &Value) -> Result<ToolOutput, String> {
        let plugin_id = params["plugin_id"].as_str()
            .ok_or_else(|| "Missing 'plugin_id' parameter for analyze_usage".to_string())?;

        let plugin = self.plugin_service.get_plugin(plugin_id)?
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;

        let metrics = self.plugin_service.get_usage_metrics(plugin_id)?;

        let recent_logs = self.plugin_service.list_usage_logs(plugin_id, 30)?;

        let fail_rate = if metrics.total_executions > 0 {
            metrics.fail_count as f64 / metrics.total_executions as f64
        } else {
            0.0
        };

        let mut analysis = format!(
            "# Usage Analysis: {} (id: {})\n\n\
             ## Execution Metrics\n\
             - Total executions: {}\n\
             - Success: {}\n\
             - Failures: {}\n\
             - Failure rate: {:.1}%\n\
             - Avg duration: {:.0}ms\n\
             - Last executed: {}\n\n",
            plugin.name,
            plugin_id,
            metrics.total_executions,
            metrics.success_count,
            metrics.fail_count,
            fail_rate * 100.0,
            metrics.avg_duration_ms,
            metrics.last_executed_at,
        );

        let mut error_patterns: std::collections::HashMap<String, Vec<(String, String, String, Option<String>)>> = std::collections::HashMap::new();
        let mut tool_fail_counts: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();

        for log in &recent_logs {
            let entry = tool_fail_counts.entry(log.tool_name.clone()).or_insert((0, 0));
            if log.success {
                entry.0 += 1;
            } else {
                entry.1 += 1;
                if let Some(ref err) = log.error_message {
                    let err_key = classify_error(err);
                    let output_snippet = log.output_summary.as_ref().map(|s| s.chars().take(200).collect::<String>());
                    error_patterns.entry(err_key).or_default().push((
                        log.tool_name.clone(),
                        log.params_summary.clone(),
                        err.chars().take(300).collect(),
                        output_snippet,
                    ));
                }
            }
        }

        if !recent_logs.is_empty() {
            analysis.push_str("## Per-Tool Breakdown\n");
            for (tool_name, (ok, fail)) in &tool_fail_counts {
                let total = *ok + *fail;
                let rate = if total > 0 { *fail as f64 / total as f64 * 100.0 } else { 0.0 };
                analysis.push_str(&format!("- {}: {} calls, {} ok, {} fail ({:.0}% fail rate)\n", tool_name, total, ok, fail, rate));
            }
            analysis.push_str("\n");
        }

        if !error_patterns.is_empty() {
            analysis.push_str("## Error Patterns\n");
            for (pattern, instances) in &error_patterns {
                analysis.push_str(&format!("### {} ({} occurrences)\n", pattern, instances.len()));
                for (tool, params, err, output_snippet) in instances.iter().take(3) {
                    analysis.push_str(&format!("- Tool: {} | Params: {} | Error: {}\n", tool, params, err));
                    if let Some(ref snippet) = output_snippet {
                        analysis.push_str(&format!("  Output: {}\n", snippet));
                    }
                }
                analysis.push_str("\n");
            }
        }

        if !recent_logs.is_empty() {
            analysis.push_str("## Recent Execution Details (last 5)\n");
            for log in recent_logs.iter().take(5) {
                let status = if log.success { "✓" } else { "✗" };
                analysis.push_str(&format!(
                    "- {} {} | source={} | {}ms | params: {}\n",
                    status, log.tool_name, log.source, log.duration_ms, log.params_summary
                ));
                if !log.success {
                    if let Some(ref err) = log.error_message {
                        analysis.push_str(&format!("  Error: {}\n", err.chars().take(200).collect::<String>()));
                    }
                }
                if let Some(ref out) = log.output_summary {
                    analysis.push_str(&format!("  Output: {}\n", out.chars().take(150).collect::<String>()));
                }
            }
            analysis.push_str("\n");
        }

        let mut refine_actions: Vec<Value> = Vec::new();
        let mut changelog_items: Vec<String> = Vec::new();

        if fail_rate > 0.2 {
            for (pattern, instances) in &error_patterns {
                let tool_names: Vec<String> = instances.iter().map(|(t, _, _, _)| t.clone()).collect();
                let unique_tools: Vec<String> = {
                    let mut v = tool_names.clone();
                    v.sort();
                    v.dedup();
                    v
                };

                match pattern.as_str() {
                    "Missing Dependency" => {
                        for tool_name in &unique_tools {
                            if let Some(tool) = plugin.tools.iter().find(|t| t.name == *tool_name) {
                                let patched_script = add_dependency_install(&tool.script, instances);
                                refine_actions.push(json!({
                                    "name": tool_name,
                                    "script": patched_script,
                                }));
                                changelog_items.push(format!("Auto-install missing dependencies in tool '{}'", tool_name));
                            }
                        }
                    }
                    "File Not Found" => {
                        for tool_name in &unique_tools {
                            if let Some(tool) = plugin.tools.iter().find(|t| t.name == *tool_name) {
                                let patched_script = add_file_validation(&tool.script);
                                refine_actions.push(json!({
                                    "name": tool_name,
                                    "script": patched_script,
                                }));
                                changelog_items.push(format!("Add file existence validation in tool '{}'", tool_name));
                            }
                        }
                    }
                    "Syntax Error" => {
                        for tool_name in &unique_tools {
                            if let Some(tool) = plugin.tools.iter().find(|t| t.name == *tool_name) {
                                if tool.script.starts_with("shell:") && (tool.script.contains("python3 -c") || tool.script.contains("python -c")) {
                                    let patched_script = convert_shell_python_to_script(&tool.script);
                                    refine_actions.push(json!({
                                        "name": tool_name,
                                        "script": patched_script,
                                    }));
                                    changelog_items.push(format!("Convert shell:python3 -c to script:python3 format in tool '{}'", tool_name));
                                }
                            }
                        }
                    }
                    "Timeout" => {
                        changelog_items.push(format!("Tools {} have timeout issues - consider optimizing or chunking data", unique_tools.join(", ")));
                    }
                    _ => {
                        changelog_items.push(format!("Fix {} errors in tools: {}", pattern, unique_tools.join(", ")));
                    }
                }
            }
        }

        if metrics.avg_duration_ms > 5000.0 {
            changelog_items.push("Optimize slow execution - consider caching or reducing data processing".to_string());
        }

        if !refine_actions.is_empty() || !changelog_items.is_empty() {
            analysis.push_str("## ⚡ Recommended Refinement\n\n");
            analysis.push_str("Based on the usage analysis above, the following issues should be fixed. ");
            analysis.push_str("**Call the 'refine' action NOW with these parameters to fix the issues:**\n\n");

            if !refine_actions.is_empty() {
                analysis.push_str("```json\n");
                let refine_params = json!({
                    "action": "refine",
                    "plugin_id": plugin_id,
                    "patch_tools": refine_actions,
                    "changelog_changes": changelog_items,
                });
                analysis.push_str(&serde_json::to_string_pretty(&refine_params).unwrap_or_default());
                analysis.push_str("\n```\n\n");
                analysis.push_str("**IMPORTANT**: Copy the JSON above and call the plugin_manager tool with it. ");
                analysis.push_str("After refining, use the 'test' action to verify the fixes work.\n");
            } else {
                analysis.push_str("The issues require manual script review. Use the 'get' action to inspect the current scripts, ");
                analysis.push_str("then use 'refine' with patch_tools to fix them.\n");
            }
        } else if metrics.total_executions > 0 {
            analysis.push_str("## Status: Healthy ✓\nNo immediate optimization needed. The plugin is performing well.");
        } else {
            analysis.push_str("## No Usage Data\nThis plugin has not been executed yet. Use the 'test' action to verify it works.");
        }

        Ok(ToolOutput {
            success: true,
            result: analysis,
            metadata: json!({
                "pluginId": plugin_id,
                "totalExecutions": metrics.total_executions,
                "failRate": fail_rate,
                "avgDurationMs": metrics.avg_duration_ms,
                "needsRefinement": !refine_actions.is_empty(),
                "refineActions": refine_actions.len(),
                "errorPatterns": error_patterns.keys().collect::<Vec<_>>(),
            }),
        })
    }

    fn infer_group_id(&self, name: &str, description: &str) -> String {
        let text = format!("{} {}", name.to_lowercase(), description.to_lowercase());

        let network_keywords = ["http", "api", "url", "request", "fetch", "web", "rest", "graphql", "ip", "dns", "ping", "download", "upload", "network"];
        let dev_keywords = ["code", "debug", "compile", "build", "test", "git", "deploy", "lint", "format", "terminal", "shell", "docker", "kubernetes", "ci", "cd"];
        let data_keywords = ["data", "csv", "json", "xml", "parse", "convert", "transform", "analyze", "statistics", "chart", "graph", "excel", "sql", "database"];
        let creative_keywords = ["image", "video", "audio", "music", "design", "draw", "paint", "color", "font", "style", "animate", "render", "creative"];

        let network_score = network_keywords.iter().filter(|k| text.contains(*k)).count();
        let dev_score = dev_keywords.iter().filter(|k| text.contains(*k)).count();
        let data_score = data_keywords.iter().filter(|k| text.contains(*k)).count();
        let creative_score = creative_keywords.iter().filter(|k| text.contains(*k)).count();

        let max_score = network_score.max(dev_score).max(data_score).max(creative_score);

        if max_score == 0 {
            return "utility".to_string();
        }

        if network_score == max_score { return "network".to_string(); }
        if dev_score == max_score { return "dev".to_string(); }
        if data_score == max_score { return "data".to_string(); }
        if creative_score == max_score { return "creative".to_string(); }

        "utility".to_string()
    }
}

fn classify_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("modulenotfounderror") || lower.contains("importerror") || lower.contains("no module named") {
        return "Missing Dependency".to_string();
    }
    if lower.contains("syntaxerror") || lower.contains("syntax error") || lower.contains("indentationerror") {
        return "Syntax Error".to_string();
    }
    if lower.contains("no such file") || lower.contains("filenotfounderror") || (lower.contains("not found") && !lower.contains("command not found")) {
        return "File Not Found".to_string();
    }
    if lower.contains("timeout") || lower.contains("timed out") {
        return "Timeout".to_string();
    }
    if lower.contains("permission denied") || lower.contains("access denied") {
        return "Permission Error".to_string();
    }
    if lower.contains("connection") || lower.contains("network") || lower.contains("dns") || lower.contains("refused") {
        return "Network Error".to_string();
    }
    if lower.contains("typeerror") || lower.contains("valueerror") || lower.contains("keyerror") {
        return "Runtime Error".to_string();
    }
    "Unknown Error".to_string()
}

fn add_dependency_install(script: &str, instances: &[(String, String, String, Option<String>)]) -> String {
    let mut packages: Vec<String> = Vec::new();
    for (_, _, err, _) in instances {
        if let Some(pkg) = extract_missing_package(err) {
            if !packages.contains(&pkg) {
                packages.push(pkg);
            }
        }
    }

    if packages.is_empty() {
        return script.to_string();
    }

    let install_line = format!("import subprocess; subprocess.check_call(['pip3', 'install', {}])\n",
        packages.iter().map(|p| format!("'{}'", p)).collect::<Vec<_>>().join(", "));

    if script.starts_with("script:python3\n") || script.starts_with("script:python\n") {
        let parts: Vec<&str> = script.splitn(2, '\n').collect();
        if parts.len() == 2 {
            return format!("{}\n{}\n{}", parts[0], install_line, parts[1]);
        }
    }

    if script.starts_with("shell:") {
        let cmd = script.trim_start_matches("shell:").trim();
        return format!("script:python3\n{}\nimport subprocess\nsubprocess.run(['python3', '-c', r#\"{}\"#], check=True)", install_line, cmd);
    }

    script.to_string()
}

fn extract_missing_package(error: &str) -> Option<String> {
    let patterns = [
        ("No module named '", "'"),
        ("No module named \"", "\""),
        ("cannot import name '", "'"),
    ];
    for (start, end) in &patterns {
        if let Some(idx) = error.find(start) {
            let after = &error[idx + start.len()..];
            if let Some(end_idx) = after.find(end) {
                let pkg = &after[..end_idx];
                let pkg_name = pkg.split('.').next().unwrap_or(pkg);
                return Some(pkg_name.to_string());
            }
        }
    }
    None
}

fn add_file_validation(script: &str) -> String {
    if script.starts_with("script:python3\n") || script.starts_with("script:python\n") {
        let parts: Vec<&str> = script.splitn(2, '\n').collect();
        if parts.len() == 2 {
            let body = &parts[1];

            let mut file_params: Vec<String> = Vec::new();
            for word in body.split(|c: char| !c.is_alphanumeric() && c != '_') {
                let lower = word.to_lowercase();
                if (lower.contains("path") || lower.contains("file") || lower.contains("input"))
                    && body.contains(&format!("{{{{{}}}}}", word))
                    && !file_params.contains(&word.to_string())
                {
                    file_params.push(word.to_string());
                }
            }

            if file_params.is_empty() {
                return script.to_string();
            }

            let mut checks = String::from("import os\nimport sys\n");
            for param in &file_params {
                checks.push_str(&format!(
                    "if not os.path.exists({}):\n    print(f'Error: File not found: {{{}}}', file=sys.stderr)\n    sys.exit(1)\n",
                    param, param
                ));
            }

            return format!("{}\n{}{}\n{}", parts[0], checks, "", body);
        }
    }
    script.to_string()
}

fn convert_shell_python_to_script(script: &str) -> String {
    let cmd = script.trim_start_matches("shell:").trim();

    if let Some(idx) = cmd.find("python3 -c \"") {
        let after = &cmd[idx + 13..];
        if let Some(end_idx) = after.rfind("\"") {
            let code = &after[..end_idx];
            return format!("script:python3\n{}", code.replace("\\n", "\n"));
        }
    }

    if let Some(idx) = cmd.find("python -c \"") {
        let after = &cmd[idx + 11..];
        if let Some(end_idx) = after.rfind("\"") {
            let code = &after[..end_idx];
            return format!("script:python3\n{}", code.replace("\\n", "\n"));
        }
    }

    if let Some(idx) = cmd.find("python3 -c '") {
        let after = &cmd[idx + 13..];
        if let Some(end_idx) = after.rfind("'") {
            let code = &after[..end_idx];
            return format!("script:python3\n{}", code.replace("\\n", "\n"));
        }
    }

    script.to_string()
}
