use std::collections::HashSet;
use std::path::PathBuf;
use serde_json::Value;

fn render_impl(
    template: &str,
    params: &Value,
    workspace_dir: Option<&PathBuf>,
    shell_safe: bool,
) -> (String, HashSet<String>) {
    let mut result = template.to_string();
    let mut used_keys = HashSet::new();

    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            let placeholder = format!("{{{{{}}}}}", key);
            if result.contains(&placeholder) {
                let str_val = match value {
                    Value::String(s) => {
                        if shell_safe { shell_quote_if_needed(s) } else { s.clone() }
                    }
                    Value::Number(n) => n.to_string(),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => String::new(),
                    other => {
                        if shell_safe { shell_quote_if_needed(&other.to_string()) } else { other.to_string() }
                    }
                };
                result = result.replace(&placeholder, &str_val);
                used_keys.insert(key.clone());
            }
        }
    }

    if let Some(dir) = workspace_dir {
        let dir_str = dir.to_string_lossy().to_string();
        if result.contains("{{output_path}}") {
            result = result.replace("{{output_path}}", &dir_str);
        }
        if result.contains("{{workspace_dir}}") {
            result = result.replace("{{workspace_dir}}", &dir_str);
        }
    }

    (result, used_keys)
}

pub fn render_template(template: &str, params: &Value) -> (String, HashSet<String>) {
    render_impl(template, params, None, false)
}

pub fn render_template_with_workspace(
    template: &str,
    params: &Value,
    workspace_dir: &PathBuf,
) -> (String, HashSet<String>) {
    render_impl(template, params, Some(workspace_dir), false)
}

pub fn render_template_shell_safe(
    template: &str,
    params: &Value,
    workspace_dir: &PathBuf,
) -> (String, HashSet<String>) {
    render_impl(template, params, Some(workspace_dir), true)
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
