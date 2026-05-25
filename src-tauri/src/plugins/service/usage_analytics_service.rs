use std::sync::Arc;

use crate::app::plugin_service::PluginService;
use crate::plugins::domain::usage_log::{
    ExecutionMetrics, RefineSuggestion,
    FixRecipe, FixErrorType, FixPatch, FixPatchType,
    StructuredRefineResult, PluginHealthStatus,
};

pub struct UsageAnalyticsService {
    plugin_service: Arc<PluginService>,
}

impl UsageAnalyticsService {
    pub fn new(plugin_service: Arc<PluginService>) -> Self {
        UsageAnalyticsService { plugin_service }
    }

    pub fn get_plugin_metrics(&self, plugin_id: &str) -> Result<ExecutionMetrics, String> {
        self.plugin_service.get_usage_metrics(plugin_id)
    }

    pub fn get_refine_suggestions(&self, plugin_id: &str) -> Result<Option<RefineSuggestion>, String> {
        let metrics = self.plugin_service.get_usage_metrics(plugin_id)?;

        if metrics.total_executions < 3 {
            return Ok(None);
        }

        let fail_rate = if metrics.total_executions > 0 {
            metrics.fail_count as f64 / metrics.total_executions as f64
        } else {
            0.0
        };

        if fail_rate < 0.2 {
            return Ok(None);
        }

        let one_day_ago = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64 - 86_400_000;

        let recent_fail_count = self.plugin_service.get_recent_fail_count(plugin_id, one_day_ago)?;

        let common_errors = self.plugin_service.get_common_errors(plugin_id, 5)?;

        let suggested_action = if fail_rate > 0.5 {
            "high_fail_rate".to_string()
        } else if fail_rate > 0.3 {
            "moderate_fail_rate".to_string()
        } else {
            "low_fail_rate".to_string()
        };

        Ok(Some(RefineSuggestion {
            plugin_id: plugin_id.to_string(),
            fail_rate,
            recent_fail_count,
            common_errors,
            suggested_action,
        }))
    }

    pub fn get_structured_refine(&self, plugin_id: &str) -> Result<StructuredRefineResult, String> {
        let metrics = self.plugin_service.get_usage_metrics(plugin_id)?;
        let fail_rate = metrics.fail_rate();

        let health_status = if fail_rate > 0.5 {
            PluginHealthStatus::Failed
        } else if fail_rate > 0.2 {
            PluginHealthStatus::Degraded
        } else {
            PluginHealthStatus::Healthy
        };

        if metrics.total_executions < 3 || fail_rate < 0.1 {
            return Ok(StructuredRefineResult {
                plugin_id: plugin_id.to_string(),
                fail_rate,
                total_executions: metrics.total_executions,
                recipes: Vec::new(),
                health_status,
            });
        }

        let common_errors = self.plugin_service.get_common_errors(plugin_id, 10)?;
        let plugin = self.plugin_service.get_plugin(plugin_id)?;

        let mut recipes: Vec<FixRecipe> = Vec::new();

        let mut error_type_counts: std::collections::HashMap<FixErrorType, Vec<(String, String)>> = std::collections::HashMap::new();

        for err in &common_errors {
            let (error_type, tool_hint) = classify_error_detailed(err);
            let tools_affected = if let Some(ref p) = plugin {
                find_affected_tools(p, err)
            } else {
                vec!["unknown".to_string()]
            };
            for tool_name in &tools_affected {
                error_type_counts
                    .entry(error_type.clone())
                    .or_default()
                    .push((tool_name.clone(), err.clone()));
            }
        }

        for (error_type, occurrences) in &error_type_counts {
            let unique_tools: Vec<String> = {
                let mut v: Vec<String> = occurrences.iter().map(|(t, _)| t.clone()).collect();
                v.sort();
                v.dedup();
                v
            };

            for tool_name in &unique_tools {
                let related_errors: Vec<&str> = occurrences.iter()
                    .filter(|(t, _)| t == tool_name)
                    .map(|(_, e)| e.as_str())
                    .collect();

                let recipe = generate_fix_recipe(error_type, tool_name, &related_errors, plugin.as_ref());
                recipes.push(recipe);
            }
        }

        recipes.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

        Ok(StructuredRefineResult {
            plugin_id: plugin_id.to_string(),
            fail_rate,
            total_executions: metrics.total_executions,
            recipes,
            health_status,
        })
    }
}

fn classify_error_detailed(error: &str) -> (FixErrorType, String) {
    let lower = error.to_lowercase();
    if lower.contains("modulenotfounderror") || lower.contains("importerror") || lower.contains("no module named") {
        let pkg = extract_missing_package(error).unwrap_or_default();
        return (FixErrorType::MissingDependency, pkg);
    }
    if lower.contains("syntaxerror") || lower.contains("syntax error") || lower.contains("indentationerror") {
        return (FixErrorType::SyntaxError, String::new());
    }
    if lower.contains("no such file") || lower.contains("filenotfounderror") || (lower.contains("not found") && !lower.contains("command not found")) {
        return (FixErrorType::FileNotFound, String::new());
    }
    if lower.contains("permission denied") || lower.contains("access denied") {
        return (FixErrorType::PermissionDenied, String::new());
    }
    if lower.contains("timeout") || lower.contains("timed out") {
        return (FixErrorType::Timeout, String::new());
    }
    if lower.contains("connection") || lower.contains("network") || lower.contains("dns") || lower.contains("refused") {
        return (FixErrorType::NetworkError, String::new());
    }
    if lower.contains("isadirectoryerror") || lower.contains("is a directory") {
        return (FixErrorType::OutputPathError, String::new());
    }
    if lower.contains("typeerror") || lower.contains("valueerror") || lower.contains("keyerror") {
        return (FixErrorType::RuntimeError, String::new());
    }
    (FixErrorType::UnknownError, String::new())
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

fn find_affected_tools(plugin: &crate::plugins::domain::plugin::PluginManifest, error: &str) -> Vec<String> {
    let mut affected = Vec::new();
    for tool in &plugin.tools {
        if error.contains(&tool.name) {
            affected.push(tool.name.clone());
            continue;
        }
        let script_lower = tool.script.to_lowercase();
        let err_lower = error.to_lowercase();
        if let Some(pkg) = extract_missing_package(error) {
            if script_lower.contains(&pkg.to_lowercase()) {
                affected.push(tool.name.clone());
                continue;
            }
        }
        if err_lower.contains("syntax") && (tool.script.starts_with("shell:python") || tool.script.contains("python3 -c")) {
            affected.push(tool.name.clone());
            continue;
        }
    }
    if affected.is_empty() {
        affected = plugin.tools.iter().map(|t| t.name.clone()).collect();
    }
    affected
}

fn generate_fix_recipe(
    error_type: &FixErrorType,
    tool_name: &str,
    related_errors: &[&str],
    plugin: Option<&crate::plugins::domain::plugin::PluginManifest>,
) -> FixRecipe {
    let tool = plugin.and_then(|p| p.tools.iter().find(|t| t.name == *tool_name));

    match error_type {
        FixErrorType::MissingDependency => {
            let packages: Vec<String> = related_errors.iter()
                .filter_map(|e| extract_missing_package(e))
                .filter_map(|p| if p.is_empty() { None } else { Some(p) })
                .collect();
            let unique_packages: Vec<String> = {
                let mut v = packages;
                v.sort();
                v.dedup();
                v
            };

            let description = format!(
                "Missing Python dependencies: {}. Will add auto-install to script header.",
                unique_packages.join(", ")
            );

            let patched_script = if let Some(t) = tool {
                add_ensure_deps_to_script(&t.script, &unique_packages)
            } else {
                String::new()
            };

            FixRecipe {
                error_type: FixErrorType::MissingDependency,
                tool_name: tool_name.to_string(),
                description,
                confidence: 0.95,
                patch: FixPatch {
                    patch_type: FixPatchType::ScriptReplace,
                    tool_name: tool_name.to_string(),
                    new_script: if patched_script.is_empty() { None } else { Some(patched_script) },
                    new_parameters: None,
                    description: format!("Add ensure_deps({}) to script", unique_packages.join(", ")),
                },
            }
        }
        FixErrorType::SyntaxError => {
            let description = if let Some(t) = tool {
                if t.script.starts_with("shell:") && (t.script.contains("python3 -c") || t.script.contains("python -c")) {
                    "Shell python -c command has syntax issues. Will convert to script:python3 format.".to_string()
                } else {
                    "Script has syntax errors. Manual review recommended.".to_string()
                }
            } else {
                "Script has syntax errors. Manual review recommended.".to_string()
            };

            let (patch_type, new_script) = if let Some(t) = tool {
                if t.script.starts_with("shell:") && (t.script.contains("python3 -c") || t.script.contains("python -c")) {
                    (FixPatchType::ScriptReplace, Some(convert_shell_python_to_script(&t.script)))
                } else {
                    (FixPatchType::ManualReview, None)
                }
            } else {
                (FixPatchType::ManualReview, None)
            };

            FixRecipe {
                error_type: FixErrorType::SyntaxError,
                tool_name: tool_name.to_string(),
                description,
                confidence: if matches!(patch_type, FixPatchType::ScriptReplace) { 0.9 } else { 0.3 },
                patch: FixPatch {
                    patch_type,
                    tool_name: tool_name.to_string(),
                    new_script,
                    new_parameters: None,
                    description: "Fix script syntax".to_string(),
                },
            }
        }
        FixErrorType::OutputPathError => {
            let description = "Script writes to a directory path instead of a file. Will fix output path handling.".to_string();
            let patched_script = if let Some(t) = tool {
                fix_output_path_in_script(&t.script)
            } else {
                String::new()
            };

            FixRecipe {
                error_type: FixErrorType::OutputPathError,
                tool_name: tool_name.to_string(),
                description,
                confidence: 0.85,
                patch: FixPatch {
                    patch_type: FixPatchType::ScriptReplace,
                    tool_name: tool_name.to_string(),
                    new_script: if patched_script.is_empty() { None } else { Some(patched_script) },
                    new_parameters: None,
                    description: "Fix output path to append filename".to_string(),
                },
            }
        }
        FixErrorType::FileNotFound => {
            let description = "Script references a file that doesn't exist. Will add file validation.".to_string();
            let patched_script = if let Some(t) = tool {
                add_file_validation_to_script(&t.script)
            } else {
                String::new()
            };

            FixRecipe {
                error_type: FixErrorType::FileNotFound,
                tool_name: tool_name.to_string(),
                description,
                confidence: 0.8,
                patch: FixPatch {
                    patch_type: FixPatchType::ScriptPrefix,
                    tool_name: tool_name.to_string(),
                    new_script: if patched_script.is_empty() { None } else { Some(patched_script) },
                    new_parameters: None,
                    description: "Add file existence check before processing".to_string(),
                },
            }
        }
        FixErrorType::Timeout => {
            FixRecipe {
                error_type: FixErrorType::Timeout,
                tool_name: tool_name.to_string(),
                description: "Script execution timed out. Consider optimizing or chunking data processing.".to_string(),
                confidence: 0.5,
                patch: FixPatch {
                    patch_type: FixPatchType::ManualReview,
                    tool_name: tool_name.to_string(),
                    new_script: None,
                    new_parameters: None,
                    description: "Optimize script performance or add chunking".to_string(),
                },
            }
        }
        FixErrorType::PermissionDenied => {
            FixRecipe {
                error_type: FixErrorType::PermissionDenied,
                tool_name: tool_name.to_string(),
                description: "Script lacks permission to access a resource. User needs to grant access.".to_string(),
                confidence: 0.6,
                patch: FixPatch {
                    patch_type: FixPatchType::ManualReview,
                    tool_name: tool_name.to_string(),
                    new_script: None,
                    new_parameters: None,
                    description: "Grant necessary permissions or change file paths".to_string(),
                },
            }
        }
        _ => {
            FixRecipe {
                error_type: error_type.clone(),
                tool_name: tool_name.to_string(),
                description: format!("Errors detected in tool '{}'. Manual review recommended.", tool_name),
                confidence: 0.2,
                patch: FixPatch {
                    patch_type: FixPatchType::ManualReview,
                    tool_name: tool_name.to_string(),
                    new_script: None,
                    new_parameters: None,
                    description: "Manual review and fix needed".to_string(),
                },
            }
        }
    }
}

fn add_ensure_deps_to_script(script: &str, packages: &[String]) -> String {
    if packages.is_empty() {
        return script.to_string();
    }

    let install_code = format!(
        "import subprocess, sys\nfor _pkg in [{}]:\n    try:\n        __import__(_pkg)\n    except ImportError:\n        subprocess.check_call([sys.executable, '-m', 'pip', 'install', _pkg, '-q'])\n",
        packages.iter().map(|p| format!("'{}'", p)).collect::<Vec<_>>().join(", ")
    );

    if script.starts_with("script:python3\n") || script.starts_with("script:python\n") {
        let parts: Vec<&str> = script.splitn(2, '\n').collect();
        if parts.len() == 2 {
            let body = parts[1];
            if body.contains("ensure_deps") || body.contains("subprocess.check_call") {
                return script.to_string();
            }
            return format!("{}\n{}{}", parts[0], install_code, body);
        }
    }

    if script.starts_with("shell:") {
        let cmd = script.trim_start_matches("shell:").trim();
        return format!("script:python3\n{}import subprocess\nsubprocess.run(['python3', '-c', r#\"{}\"#], check=True)", install_code, cmd);
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

    script.to_string()
}

fn fix_output_path_in_script(script: &str) -> String {
    let mut result = script.to_string();

    if result.contains("script:python3") || result.contains("script:python") {
        result = result.replace(
            "open(\"{{workspace_dir}}\", \"w\")",
            "open(\"{{workspace_dir}}/output.json\", \"w\")"
        );
        result = result.replace(
            "open('{{workspace_dir}}', 'w')",
            "open('{{workspace_dir}}/output.json', 'w')"
        );
        result = result.replace(
            "open(\"{{output_path}}\", \"w\")",
            "open(\"{{output_path}}/output.json\", \"w\")"
        );
        result = result.replace(
            "open('{{output_path}}', 'w')",
            "open('{{output_path}}/output.json', 'w')"
        );
    }

    result
}

fn add_file_validation_to_script(script: &str) -> String {
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

            return format!("{}\n{}{}", parts[0], checks, body);
        }
    }
    script.to_string()
}
