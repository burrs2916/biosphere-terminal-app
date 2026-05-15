use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedCommand {
    pub raw: String,
    pub program: String,
    pub args: Vec<String>,
    pub has_pipe: bool,
    pub has_redirect: bool,
    pub is_background: bool,
    pub pipe_segments: Vec<String>,
}

pub struct CommandParser;

impl CommandParser {
    pub fn new() -> Self {
        CommandParser
    }

    pub fn parse(&self, input: &str) -> ParsedCommand {
        let trimmed = input.trim();
        let is_background = trimmed.ends_with('&');

        let cleaned = if is_background {
            trimmed.trim_end_matches('&').trim_end()
        } else {
            trimmed
        };

        let pipe_segments: Vec<String> = cleaned
            .split('|')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let has_pipe = pipe_segments.len() > 1;
        let has_redirect = cleaned.contains('>') || cleaned.contains(">>") || cleaned.contains("<");

        let first_segment = pipe_segments.first().map(|s| s.as_str()).unwrap_or("");
        let tokens = Self::tokenize(first_segment);

        let program = tokens.first().cloned().unwrap_or_default();
        let args = tokens[1..].to_vec();

        ParsedCommand {
            raw: trimmed.to_string(),
            program,
            args,
            has_pipe,
            has_redirect,
            is_background,
            pipe_segments,
        }
    }

    fn tokenize(input: &str) -> Vec<String> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        let mut in_single_quote = false;
        let mut in_double_quote = false;
        let mut escape_next = false;

        for ch in input.chars() {
            if escape_next {
                current.push(ch);
                escape_next = false;
                continue;
            }

            if ch == '\\' && !in_single_quote {
                escape_next = true;
                continue;
            }

            if ch == '\'' && !in_double_quote {
                in_single_quote = !in_single_quote;
                continue;
            }

            if ch == '"' && !in_single_quote {
                in_double_quote = !in_double_quote;
                continue;
            }

            if ch == ' ' && !in_single_quote && !in_double_quote {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
                continue;
            }

            current.push(ch);
        }

        if !current.is_empty() {
            tokens.push(current);
        }

        tokens
    }

    pub fn is_dangerous(&self, parsed: &ParsedCommand) -> bool {
        let dangerous_patterns = [
            "rm -rf /",
            "rm -rf /*",
            "mkfs",
            "dd if=",
            "> /dev/sd",
            ":(){ :|:& };:",
            "chmod -R 777 /",
            "chown -R",
            "wget",
            "curl",
        ];

        let raw_lower = parsed.raw.to_lowercase();
        for pattern in dangerous_patterns {
            if raw_lower.contains(pattern) {
                return true;
            }
        }

        let dangerous_programs = ["mkfs", "fdisk", "parted", "dd"];
        for prog in dangerous_programs {
            if parsed.program == prog {
                return true;
            }
        }

        if parsed.program == "rm" {
            let has_recursive = parsed.args.iter().any(|a| a == "-r" || a == "-rf" || a == "-fr");
            let has_root = parsed.args.iter().any(|a| a == "/" || a == "/*");
            if has_recursive && has_root {
                return true;
            }
        }

        false
    }
}
