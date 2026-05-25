use std::collections::HashSet;
use std::path::PathBuf;
use serde_json::Value;

pub fn render_template(template: &str, params: &Value) -> (String, HashSet<String>) {
    let mut result = template.to_string();
    let mut used_keys = HashSet::new();

    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key);
            if result.contains(&placeholder) {
                let str_val = match value {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                result = result.replace(&placeholder, &str_val);
                used_keys.insert(key.clone());
            }
        }
    }

    (result, used_keys)
}

pub fn render_template_with_workspace(template: &str, params: &Value, workspace_dir: &PathBuf) -> (String, HashSet<String>) {
    let (mut result, used_keys) = render_template(template, params);
    let dir_str = workspace_dir.to_string_lossy().to_string();

    let output_path_placeholder = "{{output_path}}";
    let workspace_dir_placeholder = "{{workspace_dir}}";

    if result.contains(output_path_placeholder) {
        result = result.replace(output_path_placeholder, &dir_str);
    }
    if result.contains(workspace_dir_placeholder) {
        result = result.replace(workspace_dir_placeholder, &dir_str);
    }

    (result, used_keys)
}

pub fn render_template_shell_safe(template: &str, params: &Value, workspace_dir: &PathBuf) -> (String, HashSet<String>) {
    let mut result = template.to_string();
    let mut used_keys = HashSet::new();

    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key);
            if result.contains(&placeholder) {
                let str_val = match value {
                    Value::String(s) => shell_quote_if_needed(s),
                    Value::Number(n) => n.to_string(),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => String::new(),
                    other => shell_quote_if_needed(&other.to_string()),
                };
                result = result.replace(&placeholder, &str_val);
                used_keys.insert(key.clone());
            }
        }
    }

    let dir_str = workspace_dir.to_string_lossy().to_string();

    if result.contains("{{output_path}}") {
        result = result.replace("{{output_path}}", &dir_str);
    }
    if result.contains("{{workspace_dir}}") {
        result = result.replace("{{workspace_dir}}", &dir_str);
    }

    (result, used_keys)
}

fn shell_quote_if_needed(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }

    let needs_quoting = s.contains(' ')
        || s.contains('\t')
        || s.contains('"')
        || s.contains('\'')
        || s.contains('$')
        || s.contains('`')
        || s.contains('\\')
        || s.contains('(')
        || s.contains(')')
        || s.contains('!')
        || s.contains('*')
        || s.contains('?')
        || s.contains('[')
        || s.contains(']')
        || s.contains('{')
        || s.contains('}')
        || s.contains('|')
        || s.contains('&')
        || s.contains(';')
        || s.contains('<')
        || s.contains('>')
        || s.contains('~')
        || s.contains('#')
        || s.contains('\n');

    if !needs_quoting {
        return s.to_string();
    }

    if !s.contains('\'') {
        return format!("'{}'", s);
    }

    let escaped: String = s.replace('\\', "\\\\").replace('"', "\\\"").replace('$', "\\$").replace('`', "\\`");
    format!("\"{}\"", escaped)
}

#[allow(dead_code)]
pub fn sanitize_path(path: &str) -> Option<String> {
    let p = std::path::Path::new(path);

    for component in p.components() {
        if let std::path::Component::Normal(os_str) = component {
            let s = os_str.to_string_lossy();
            if s == ".." {
                return None;
            }
        } else if let std::path::Component::ParentDir = component {
            return None;
        }
    }

    Some(path.to_string())
}
