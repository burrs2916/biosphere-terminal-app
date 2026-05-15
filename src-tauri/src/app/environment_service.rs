use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub shell: String,
    pub home_dir: String,
    pub hostname: String,
    pub user: String,
    pub tools: Vec<ToolInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub version: String,
    pub path: String,
}

impl EnvironmentInfo {
    pub fn detect() -> Self {
        let os = std::env::consts::OS.to_string();
        let arch = std::env::consts::ARCH.to_string();
        let home_dir = dirs_next().unwrap_or_else(|| "/".to_string());
        let hostname = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "unknown".to_string());
        let user = whoami();

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "unknown".to_string());

        let os_version = Self::detect_os_version(&os);

        let tools = Self::detect_tools();

        EnvironmentInfo {
            os,
            os_version,
            arch,
            shell,
            home_dir,
            hostname,
            user,
            tools,
        }
    }

    fn detect_os_version(os: &str) -> String {
        if os == "macos" {
            if let Ok(output) = std::process::Command::new("sw_vers")
                .arg("-productVersion")
                .output()
            {
                return String::from_utf8_lossy(&output.stdout).trim().to_string();
            }
        } else if os == "linux" {
            if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
                for line in content.lines() {
                    if line.starts_with("PRETTY_NAME=") {
                        return line
                            .trim_start_matches("PRETTY_NAME=")
                            .trim_matches('"')
                            .to_string();
                    }
                }
            }
        }
        "unknown".to_string()
    }

    fn detect_tools() -> Vec<ToolInfo> {
        let tool_names = vec![
            "git", "docker", "node", "npm", "pnpm", "yarn",
            "python3", "python", "go", "rustc", "cargo",
            "java", "kubectl", "helm", "terraform",
        ];

        let mut tools = Vec::new();
        for name in tool_names {
            if let Some(version) = Self::get_tool_version(name) {
                let path = Self::find_executable(name).unwrap_or_default();
                tools.push(ToolInfo {
                    name: name.to_string(),
                    version,
                    path,
                });
            }
        }
        tools
    }

    fn get_tool_version(name: &str) -> Option<String> {
        let (cmd, args) = match name {
            "git" => ("git", vec!["--version"]),
            "docker" => ("docker", vec!["--version"]),
            "node" => ("node", vec!["--version"]),
            "npm" => ("npm", vec!["--version"]),
            "pnpm" => ("pnpm", vec!["--version"]),
            "yarn" => ("yarn", vec!["--version"]),
            "python3" => ("python3", vec!["--version"]),
            "python" => ("python", vec!["--version"]),
            "go" => ("go", vec!["version"]),
            "rustc" => ("rustc", vec!["--version"]),
            "cargo" => ("cargo", vec!["--version"]),
            "java" => ("java", vec!["--version"]),
            "kubectl" => ("kubectl", vec!["version", "--client=true"]),
            "helm" => ("helm", vec!["version", "--short"]),
            "terraform" => ("terraform", vec!["--version"]),
            _ => return None,
        };

        if let Ok(output) = std::process::Command::new(cmd).args(args).output() {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !version.is_empty() {
                return Some(version);
            }
        }
        None
    }

    fn find_executable(name: &str) -> Option<String> {
        if let Ok(output) = std::process::Command::new("which").arg(name).output() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
        None
    }
}

fn dirs_next() -> Option<String> {
    std::env::var("HOME").ok()
}

fn whoami() -> String {
    std::env::var("USER").unwrap_or_else(|_| "unknown".to_string())
}
