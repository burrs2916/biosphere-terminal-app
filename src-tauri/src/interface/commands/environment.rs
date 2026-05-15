use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDto {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub shell: String,
    pub home_dir: String,
    pub hostname: String,
    pub user: String,
    pub tools: Vec<ToolDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDto {
    pub name: String,
    pub version: String,
    pub path: String,
}

#[tauri::command]
pub fn get_environment() -> Result<EnvironmentDto, String> {
    let info = crate::app::environment_service::EnvironmentInfo::detect();

    Ok(EnvironmentDto {
        os: info.os,
        os_version: info.os_version,
        arch: info.arch,
        shell: info.shell,
        home_dir: info.home_dir,
        hostname: info.hostname,
        user: info.user,
        tools: info.tools.iter().map(|t| ToolDto {
            name: t.name.clone(),
            version: t.version.clone(),
            path: t.path.clone(),
        }).collect(),
    })
}
