use crate::app::connection_service::ConnectionService;
use crate::core::types::{ConnectionConfig, SshConnectionInfo};
use crate::infra::storage::database::Database;
use tauri::State;
use std::sync::Arc;
use std::net::TcpStream;
use std::time::Duration;

#[tauri::command]
pub fn list_connections(db: State<'_, Arc<Database>>) -> Result<Vec<ConnectionConfig>, String> {
    ConnectionService::list_connections(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_connection(
    config: ConnectionConfig,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ConnectionService::save_connection(&db, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_connection(
    id: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    ConnectionService::delete_connection(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn test_connection(ssh: SshConnectionInfo) -> Result<String, String> {
    let addr = format!("{}:{}", ssh.host, ssh.port);
    match TcpStream::connect_timeout(&addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?, Duration::from_secs(5)) {
        Ok(_) => Ok(format!("Connected to {}:{} successfully", ssh.host, ssh.port)),
        Err(e) => Err(format!("Failed to connect to {}:{} - {}", ssh.host, ssh.port, e)),
    }
}
