mod core;
mod domain;
mod infra;
mod app;
mod interface;
mod plugins;

use std::sync::Arc;
use tauri::Manager;

use infra::storage::database::Database;
use app::terminal_service::TerminalService;
use app::notebook_service::NotebookService;
use app::agent_service::AgentService;
use app::plugin_service::PluginService;
use app::linker_service::LinkerService;
use app::icon_service::IconService;
use app::remote_desktop_service::RemoteDesktopService;
use domain::command::executor::CommandExecutor;

fn get_dev_data_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(".data")
        .join("dev")
}

fn get_dev_log_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf()
        .join("logs")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let terminal_service = Arc::new(TerminalService::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal_service.clone())
        .setup(move |app| {
            let app_handle = app.handle();

            // Resolve data/log directory based on environment.
            // In production we MUST use a user-writable location (app_data_dir),
            // because exe_dir is read-only on macOS (.app), Windows (Program Files)
            // and Linux package installs.
            let (data_dir, log_dir) = if cfg!(debug_assertions) {
                (get_dev_data_dir(), get_dev_log_dir())
            } else {
                let data = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("failed to resolve app_data_dir: {}", e))?;
                let logs = data.join("logs");
                (data, logs)
            };

            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("Warning: could not create data dir {:?}: {}", data_dir, e);
            }
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!("Warning: could not create log dir {:?}: {}", log_dir, e);
            }

            infra::logging::init(&log_dir);

            tracing::info!("[app] data directory: {:?}", data_dir);
            tracing::info!("[app] log directory: {:?}", log_dir);

            terminal_service.set_app_handle(app_handle.clone())?;

            let db_path = data_dir.join("biosphere.db");
            let notes_dir = data_dir.join("notes");

            let _ = std::fs::create_dir_all(&notes_dir);

            let db = match Database::open(&db_path) {
                Ok(db) => db,
                Err(e) => {
                    tracing::error!("[app] failed to open database at {:?}: {}", db_path, e);
                    // Show user-friendly error dialog before exiting.
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    let _ = app_handle
                        .dialog()
                        .message(format!(
                            "Biosphere Terminal failed to start.\n\nUnable to open the local database at:\n{}\n\nReason: {}\n\nPlease check folder permissions and try again.",
                            db_path.display(),
                            e
                        ))
                        .title("Database initialization failed")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(Box::new(std::io::Error::other(format!(
                        "failed to open database at {:?}: {}",
                        db_path, e
                    ))));
                }
            };
            let db_arc = Arc::new(db);

            let notebook_service = Arc::new(NotebookService::new(notes_dir, db_arc.clone()));
            let agent_service = Arc::new(AgentService::new(db_arc.clone(), notebook_service.clone(), terminal_service.clone()));
            let plugin_service = Arc::new(PluginService::new(data_dir.clone(), db_arc.clone()));
            let linker_service = Arc::new(LinkerService::new(
                notebook_service.clone(),
                db_arc.clone(),
            ));
            let command_executor = Arc::new(CommandExecutor::new(db_arc.clone()));
            let icons_dir = data_dir.join("icons");
            let icon_service = Arc::new(IconService::new(db_arc.clone(), icons_dir));
            let remote_desktop_service = Arc::new(RemoteDesktopService::new());

            app_handle.manage(db_arc);
            app_handle.manage(notebook_service);
            app_handle.manage(agent_service);
            app_handle.manage(plugin_service);
            app_handle.manage(linker_service);
            app_handle.manage(command_executor);
            app_handle.manage(icon_service);
            app_handle.manage(remote_desktop_service);

            // Open DevTools for debugging (including production builds)
            if let Some(window) = app_handle.get_webview_window("main") {
                window.open_devtools();
                tracing::info!("[app] DevTools opened for debugging");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            interface::commands::terminal::spawn_terminal,
            interface::commands::terminal::write_to_terminal,
            interface::commands::terminal::kill_terminal,
            interface::commands::terminal::resize_terminal,
            interface::commands::terminal::relay_execute_command,
            interface::commands::terminal::get_terminal_cwd,
            interface::commands::session::list_sessions,
            interface::commands::session::create_session,
            interface::commands::session::delete_session,
            interface::commands::command::get_command_history,
            interface::commands::command::save_command_history,
            interface::commands::command::search_command_history,
            interface::commands::command::list_snippets,
            interface::commands::command::save_snippet,
            interface::commands::command::delete_snippet,
            interface::commands::command::parse_command,
            interface::commands::command::record_exit_code,
            interface::commands::command::delete_command_history,
            interface::commands::command::clear_command_history,
            interface::commands::profile::list_profiles,
            interface::commands::profile::save_profile,
            interface::commands::profile::delete_profile,
            interface::commands::connection::list_connections,
            interface::commands::connection::save_connection,
            interface::commands::connection::delete_connection,
            interface::commands::connection::test_connection,
            interface::commands::plugin::list_plugins,
            interface::commands::plugin::get_plugin,
            interface::commands::plugin::save_plugin,
            interface::commands::plugin::delete_plugin,
            interface::commands::plugin::toggle_plugin,
            interface::commands::plugin::list_plugin_tools,
            interface::commands::plugin::list_plugin_groups,
            interface::commands::plugin::create_plugin_group,
            interface::commands::plugin::update_plugin_group,
            interface::commands::plugin::delete_plugin_group,
            interface::commands::plugin::list_plugin_categories,
            interface::commands::plugin::create_plugin_category,
            interface::commands::plugin::update_plugin_category,
            interface::commands::plugin::delete_plugin_category,
            interface::commands::plugin::run_plugin_tool,
            interface::commands::plugin::get_plugin_tool_ui_schema,
            interface::commands::plugin::get_plugin_usage_metrics,
            interface::commands::plugin::get_plugin_refine_suggestions,
            interface::commands::plugin::get_plugin_structured_refine,
            interface::commands::plugin::list_plugin_usage_logs,
            interface::commands::plugin::clear_plugin_usage_logs,
            interface::commands::plugin::clear_usage_logs_before,
            interface::commands::plugin::clear_failed_logs_before,
            interface::commands::plugin::purge_all_usage_logs,
            interface::commands::plugin::count_plugin_usage_logs,
            interface::commands::plugin::count_all_usage_logs,
            interface::commands::plugin::usage_logs_size_estimate,
            interface::commands::plugin::export_plugin_usage_logs,
            interface::commands::plugin::export_all_usage_logs,
            interface::commands::notebook::list_notes,
            interface::commands::notebook::get_note,
            interface::commands::notebook::create_note,
            interface::commands::notebook::update_note,
            interface::commands::notebook::delete_note,
            interface::commands::notebook::toggle_pin_note,
            interface::commands::notebook::search_notes,
            interface::commands::notebook::list_note_categories,
            interface::commands::notebook::link_command_to_note,
            interface::commands::notebook::get_linked_commands,
            interface::commands::notebook::get_linked_notes,
            interface::commands::notebook::get_notes_for_command_text,
            interface::commands::notebook::list_note_groups,
            interface::commands::notebook::create_note_group,
            interface::commands::notebook::update_note_group,
            interface::commands::notebook::delete_note_group,
            interface::commands::notebook::list_note_categories_by_group,
            interface::commands::notebook::create_note_category,
            interface::commands::notebook::update_note_category,
            interface::commands::notebook::delete_note_category,
            interface::commands::agent::list_providers,
            interface::commands::agent::save_provider,
            interface::commands::agent::delete_provider,
            interface::commands::agent::list_endpoints,
            interface::commands::agent::list_endpoints_by_provider,
            interface::commands::agent::save_endpoint,
            interface::commands::agent::delete_endpoint,
            interface::commands::agent::list_models,
            interface::commands::agent::list_models_by_endpoint,
            interface::commands::agent::save_model,
            interface::commands::agent::delete_model,
            interface::commands::agent::test_endpoint_connection,
            interface::commands::agent::test_model_chat,
            interface::commands::agent::list_agents,
            interface::commands::agent::save_agent,
            interface::commands::agent::delete_agent,
            interface::commands::agent::list_conversations,
            interface::commands::agent::create_conversation,
            interface::commands::agent::delete_conversation,
            interface::commands::agent::update_conversation_title,
            interface::commands::agent::list_messages,
            interface::commands::agent::save_message,
            interface::commands::agent::delete_messages_after,
            interface::commands::agent::run_agent,
            interface::commands::agent::stop_agent,
            interface::commands::agent::write_frontend_log,
            interface::commands::agent::generate_plugin_scenarios,
            interface::commands::agent::respond_permission,
            interface::commands::agent::save_plugin_scenarios,
            interface::commands::agent::delete_plugin_scenario,
            interface::commands::agent::update_agent_allowed_tools,
            interface::commands::environment::get_environment,
            interface::commands::icon::list_icon_groups,
            interface::commands::icon::create_icon_group,
            interface::commands::icon::update_icon_group,
            interface::commands::icon::delete_icon_group,
            interface::commands::icon::list_custom_icons,
            interface::commands::icon::upload_custom_icon,
            interface::commands::icon::delete_custom_icon,
            interface::commands::icon::get_custom_icon_urls,
            interface::commands::icon::get_custom_icon_url,
            interface::commands::notebook::unlink_command_note,
            interface::commands::remote_desktop::create_remote_desktop,
            interface::commands::remote_desktop::close_remote_desktop,
            interface::commands::remote_desktop::setup_remote_desktop,
        ])
        .run(tauri::generate_context!())?;

    Ok(())
}
