use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSchema {
    #[serde(default = "default_form_layout")]
    pub layout: String,
    #[serde(default)]
    pub fields: Vec<UiField>,
    #[serde(default = "default_submit_label")]
    pub submit_label: String,
    #[serde(default)]
    pub quick_actions: Vec<QuickAction>,
    #[serde(default)]
    pub interaction: Option<InteractionSpec>,
}

fn default_form_layout() -> String {
    "vertical".to_string()
}

fn default_submit_label() -> String {
    "Execute".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSpec {
    #[serde(default)]
    pub steps: Vec<InteractionStep>,
    #[serde(default)]
    pub result_actions: Vec<ResultAction>,
    #[serde(default)]
    pub streaming: Option<StreamingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionStep {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub auto_advance: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultAction {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub action_type: String,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingSpec {
    #[serde(default = "default_progress_pattern")]
    pub progress_pattern: String,
    #[serde(default)]
    pub status_field: Option<String>,
    #[serde(default = "default_true")]
    pub show_progress: bool,
}

fn default_progress_pattern() -> String {
    r#"\[PROGRESS:(\d+)%\]"#.to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiField {
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default = "default_ui_widget_text")]
    pub widget: String,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub accept: Option<String>,
    #[serde(default)]
    pub multiple: Option<bool>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub order: Option<u32>,
    #[serde(default)]
    pub min_value: Option<f64>,
    #[serde(default)]
    pub max_value: Option<f64>,
    #[serde(default)]
    pub step: Option<f64>,
}

fn default_ui_widget_text() -> String {
    "text".to_string()
}

impl UiSchema {
    pub fn from_tool_parameters(parameters: &[super::plugin::ToolParameter]) -> Self {
        let mut fields: Vec<UiField> = parameters.iter().enumerate().map(|(idx, p)| {
            let widget = p.ui_widget.clone().unwrap_or_else(|| infer_widget(&p.param_type, &p.name, &p.ui_options));
            UiField {
                name: p.name.clone(),
                label: p.ui_label.clone().or_else(|| Some(p.name.clone())),
                widget,
                placeholder: p.ui_placeholder.clone().or_else(|| Some(p.description.clone())),
                options: p.ui_options.clone(),
                accept: p.ui_accept.clone(),
                multiple: None,
                group: p.ui_group.clone().or_else(|| infer_group(&p.name)),
                order: p.ui_order.or_else(|| Some(idx as u32)),
                min_value: None,
                max_value: None,
                step: None,
            }
        }).collect();

        fields.sort_by_key(|f| f.order.unwrap_or(999));

        let interaction = Self::generate_interaction(parameters);

        UiSchema {
            layout: "vertical".to_string(),
            fields,
            submit_label: "Execute".to_string(),
            quick_actions: Vec::new(),
            interaction: Some(interaction),
        }
    }

    pub fn with_interaction(mut self, interaction: InteractionSpec) -> Self {
        self.interaction = Some(interaction);
        self
    }

    fn generate_interaction(parameters: &[super::plugin::ToolParameter]) -> InteractionSpec {
        let file_params: Vec<&super::plugin::ToolParameter> = parameters.iter()
            .filter(|p| {
                let name_lower = p.name.to_lowercase();
                name_lower.contains("path") || name_lower.contains("file") || name_lower.contains("input")
            })
            .collect();

        let option_params: Vec<&super::plugin::ToolParameter> = parameters.iter()
            .filter(|p| !file_params.iter().any(|fp| fp.name == p.name))
            .collect();

        let mut steps: Vec<InteractionStep> = Vec::new();

        if !file_params.is_empty() {
            steps.push(InteractionStep {
                id: "input".to_string(),
                title: "Select Input".to_string(),
                description: Some("Choose the file(s) to process".to_string()),
                fields: file_params.iter().map(|p| p.name.clone()).collect(),
                auto_advance: true,
            });
        }

        if !option_params.is_empty() {
            steps.push(InteractionStep {
                id: "options".to_string(),
                title: "Options".to_string(),
                description: Some("Configure processing options".to_string()),
                fields: option_params.iter().map(|p| p.name.clone()).collect(),
                auto_advance: false,
            });
        }

        if steps.is_empty() {
            steps.push(InteractionStep {
                id: "configure".to_string(),
                title: "Configure".to_string(),
                description: None,
                fields: Vec::new(),
                auto_advance: true,
            });
        }

        let mut result_actions = vec![
            ResultAction {
                id: "re_run".to_string(),
                label: "Run Again".to_string(),
                icon: Some("refresh".to_string()),
                action_type: "re_run".to_string(),
                params: None,
                tool_name: None,
                description: Some("Execute the tool again with same parameters".to_string()),
            },
            ResultAction {
                id: "copy_result".to_string(),
                label: "Copy Result".to_string(),
                icon: Some("copy".to_string()),
                action_type: "copy_result".to_string(),
                params: None,
                tool_name: None,
                description: Some("Copy the result to clipboard".to_string()),
            },
        ];

        let has_file_output = parameters.iter().any(|p| {
            let name_lower = p.name.to_lowercase();
            name_lower.contains("output") || name_lower.contains("save") || name_lower.contains("export")
        });

        if has_file_output {
            result_actions.insert(1, ResultAction {
                id: "open_file".to_string(),
                label: "Open File".to_string(),
                icon: Some("folder".to_string()),
                action_type: "open_file".to_string(),
                params: None,
                tool_name: None,
                description: Some("Open the output file".to_string()),
            });
        }

        InteractionSpec {
            steps,
            result_actions,
            streaming: None,
        }
    }
}

fn infer_group(param_name: &str) -> Option<String> {
    let name_lower = param_name.to_lowercase();
    if name_lower.contains("path") || name_lower.contains("file") || name_lower.contains("input") {
        Some("input".to_string())
    } else if name_lower.contains("output") || name_lower.contains("save") || name_lower.contains("export") {
        Some("output".to_string())
    } else if name_lower.contains("option") || name_lower.contains("format") || name_lower.contains("mode") || name_lower.contains("type") {
        Some("options".to_string())
    } else {
        None
    }
}

fn infer_widget(param_type: &str, param_name: &str, ui_options: &Option<Vec<String>>) -> String {
    if ui_options.is_some() {
        return "select".to_string();
    }
    let name_lower = param_name.to_lowercase();
    if name_lower.contains("path") || name_lower.contains("file") || name_lower.contains("input_file") || name_lower.contains("output_path") {
        return "file".to_string();
    }
    if name_lower.contains("url") || name_lower.contains("link") {
        return "text".to_string();
    }
    if name_lower.contains("description") || name_lower.contains("content") || name_lower.contains("text") || name_lower.contains("query") && param_type == "string" {
        return "textarea".to_string();
    }
    match param_type {
        "number" | "integer" => "number".to_string(),
        "boolean" => "checkbox".to_string(),
        "array" => "textarea".to_string(),
        _ => "text".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAction {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub preset_params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultViewSpec {
    #[serde(default = "default_view_type")]
    pub view_type: String,
    #[serde(default)]
    pub columns: Option<Vec<TableColumn>>,
    #[serde(default)]
    pub actions: Option<Vec<String>>,
}

fn default_view_type() -> String {
    "text".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub width: Option<String>,
}
