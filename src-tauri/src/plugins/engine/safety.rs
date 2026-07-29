const SHELL_DANGEROUS_COMMANDS: &[&str] = &[
    "rm -rf /", "rm -rf /*", "mkfs", "dd if=", ":(){ :|:&", "fork bomb",
    "shutdown", "reboot", "init 0", "init 6",
    "format c:", "del /f /s /q c:",
    "chmod -r 777 /", "chown -r root /",
    "> /etc/passwd", "> /etc/shadow",
    "curl | sh", "curl | bash", "wget | sh", "wget | bash",
    "nc -l", "ncat -l",
];

pub fn is_dangerous_command(command: &str) -> Option<&'static str> {
    let command_lower = command.to_lowercase();
    for dangerous in SHELL_DANGEROUS_COMMANDS {
        if command_lower.contains(dangerous) {
            return Some(dangerous);
        }
    }
    None
}

pub fn is_private_ip(url: &str) -> bool {
    let host = extract_host(url);
    match host.as_str() {
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" => true,
        h if h.starts_with("10.") => true,
        h if h.starts_with("192.168.") => true,
        h if is_172_private(h) => true,
        h if h.starts_with("169.254.") => true,
        _ => false,
    }
}

fn extract_host(url: &str) -> String {
    let url = url.trim();
    let without_scheme = if url.starts_with("http://") {
        &url[7..]
    } else if url.starts_with("https://") {
        &url[8..]
    } else {
        url
    };
    let without_auth = if let Some(at_pos) = without_scheme.find('@') {
        &without_scheme[at_pos + 1..]
    } else {
        without_scheme
    };
    let host_part = without_auth.split('/').next().unwrap_or(without_auth);
    let host = host_part.split(':').next().unwrap_or(host_part);
    host.to_string()
}

fn is_172_private(host: &str) -> bool {
    if !host.starts_with("172.") {
        return false;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() < 2 {
        return false;
    }
    if let Ok(second) = parts[1].parse::<u8>() {
        return second >= 16 && second <= 31;
    }
    false
}
