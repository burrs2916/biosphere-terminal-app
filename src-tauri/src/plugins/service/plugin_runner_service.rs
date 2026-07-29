use serde_json::Value;

pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

pub fn summarize_params(params: &Value) -> String {
    if let Some(obj) = params.as_object() {
        let parts: Vec<String> = obj.iter().map(|(k, v)| {
            let val_str = sanitize_param_value(v);
            format!("{}={}", k, val_str)
        }).collect();
        parts.join(", ")
    } else {
        String::from("non-object params")
    }
}

pub fn sanitize_param_value(v: &Value) -> String {
    match v {
        Value::String(s) => {
            let truncated = if s.chars().count() > 200 { format!("{}...", truncate_str(s, 200)) } else { s.clone() };
            let sanitized = truncated.replace('\n', "\\n").replace('\r', "\\r");
            format!("\"{}\"", sanitized)
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(arr) => {
            if arr.len() > 5 {
                format!("[array:{}items]", arr.len())
            } else {
                let items: Vec<String> = arr.iter().map(|item| sanitize_param_value(item)).collect();
                format!("[{}]", items.join(", "))
            }
        }
        Value::Object(_) => "[object]".to_string(),
    }
}
