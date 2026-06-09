mod core;
mod domain;
mod infra;
mod app;
mod interface;
mod plugins;

use std::sync::Arc;
use tauri::Manager;
use tauri::Listener;

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
    // Early debug log: write to debug.log next to the executable.
    // This runs BEFORE the Tauri builder so we can capture startup failures
    // (e.g. panic during setup, data dir failure, etc.) even when the UI
    // never loads (white screen).
    let exe_path = std::env::current_exe().ok();
    let debug_log_path = exe_path
        .as_ref()
        .and_then(|p| p.parent())
        .map(|d| d.join("debug.log"))
        .unwrap_or_else(|| std::path::PathBuf::from("debug.log"));

    let _ = write_debug_log(&debug_log_path, "=== Biosphere Terminal started ===");
    let _ = write_debug_log(&debug_log_path, &format!("exe: {:?}", exe_path));
    let _ = write_debug_log(&debug_log_path, &format!("args: {:?}", std::env::args().collect::<Vec<_>>()));
    let _ = write_debug_log(&debug_log_path, &format!("cwd: {:?}", std::env::current_dir().ok()));
    let _ = write_debug_log(&debug_log_path, &format!("debug.log: {:?}", debug_log_path));

    // ---- System & Environment diagnostics ----
    let _ = write_debug_log(&debug_log_path, &format!("os: {}", std::env::consts::OS));
    let _ = write_debug_log(&debug_log_path, &format!("arch: {}", std::env::consts::ARCH));
    let _ = write_debug_log(&debug_log_path, &format!("family: {}", std::env::consts::FAMILY));

    // Key environment variables that affect WebView2 / Tauri
    for key in &[
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "TAURI_ENV_DEBUG",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PATH",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
    ] {
        match std::env::var(key) {
            Ok(val) => {
                // Truncate PATH to avoid bloating the log
                if key == &"PATH" {
                    let truncated = if val.len() > 300 { &val[..300] } else { &val };
                    let _ = write_debug_log(&debug_log_path, &format!("env {} = {}...", truncated, if val.len() > 300 { " (truncated)" } else { "" }));
                } else {
                    let _ = write_debug_log(&debug_log_path, &format!("env {} = {}", key, val));
                }
            }
            Err(_) => {
                let _ = write_debug_log(&debug_log_path, &format!("env {} = (not set)", key));
            }
        }
    }

    // On Windows: check WebView2 Runtime availability
    #[cfg(target_os = "windows")]
    {
        let _ = write_debug_log(&debug_log_path, "[diag] checking WebView2 Runtime...");
        // WebView2 runtime is typically at:
        //   C:\Program Files (x86)\Microsoft\EdgeWebView\Application
        // or bundled in the app
        let possible_paths = [
            std::path::PathBuf::from(r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application"),
            std::path::PathBuf::from(r"C:\Program Files\Microsoft\EdgeWebView\Application"),
            std::path::PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application"),
            std::path::PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application"),
        ];
        for p in &possible_paths {
            if p.exists() {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] WebView2/Edge found at: {:?}", p));
                // Try to list subdirectories (version folders)
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with(|c: char| c.is_ascii_digit()) {
                            let _ = write_debug_log(&debug_log_path, &format!("[diag]   version dir: {}", name));
                        }
                    }
                }
            } else {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] WebView2/Edge NOT found at: {:?}", p));
            }
        }

        // Check registry for WebView2 version
        let _ = write_debug_log(&debug_log_path, "[diag] checking registry for WebView2...");
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKLM WOW6432Node stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKLM WOW6432Node stderr: {}", stderr.trim()));
            }
        }
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKLM stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKLM stderr: {}", stderr.trim()));
            }
        }
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKCU stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] reg query HKCU stderr: {}", stderr.trim()));
            }
        }

        // Check if msedgewebview2.exe exists in PATH or common locations
        if let Ok(output) = std::process::Command::new("where")
            .arg("msedgewebview2.exe")
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !stdout.trim().is_empty() {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] msedgewebview2.exe found: {}", stdout.trim()));
            } else {
                let _ = write_debug_log(&debug_log_path, "[diag] msedgewebview2.exe NOT found in PATH");
            }
        }
    }

    // Check if the exe directory is writable (for debug.log itself)
    if let Some(exe_dir) = exe_path.as_ref().and_then(|p| p.parent()) {
        let test_file = exe_dir.join(".biosphere_write_test");
        match std::fs::write(&test_file, b"test") {
            Ok(()) => {
                let _ = std::fs::remove_file(&test_file);
                let _ = write_debug_log(&debug_log_path, &format!("[diag] exe directory is writable: {:?}", exe_dir));
            }
            Err(e) => {
                let _ = write_debug_log(&debug_log_path, &format!("[diag] exe directory is NOT writable: {:?} ({})", exe_dir, e));
            }
        }
    }

    // Share the debug log path with the setup closure (Tauri setup is Fn once, not FnMut).
    let debug_log_for_setup = std::sync::Arc::new(debug_log_path.clone());
    let debug_log_path_for_after = debug_log_path.clone();

    let terminal_service = Arc::new(TerminalService::new());

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal_service.clone())
        .setup(move |app| {
            let app_handle = app.handle();
            let debug_log_path = (*debug_log_for_setup).clone();
            let _ = write_debug_log(&debug_log_path, "[setup] Tauri setup started");

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

            let _ = write_debug_log(&debug_log_path, &format!("[setup] data_dir: {:?}", data_dir));
            let _ = write_debug_log(&debug_log_path, &format!("[setup] log_dir: {:?}", log_dir));

            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("Warning: could not create data dir {:?}: {}", data_dir, e);
                let _ = write_debug_log(&debug_log_path, &format!("[setup] FAILED to create data dir: {}", e));
            }
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!("Warning: could not create log dir {:?}: {}", log_dir, e);
                let _ = write_debug_log(&debug_log_path, &format!("[setup] FAILED to create log dir: {}", e));
            }

            infra::logging::init(&log_dir);
            let _ = write_debug_log(&debug_log_path, "[setup] logging initialized");

            tracing::info!("[app] data directory: {:?}", data_dir);
            tracing::info!("[app] log directory: {:?}", log_dir);

            terminal_service.set_app_handle(app_handle.clone())?;
            let _ = write_debug_log(&debug_log_path, "[setup] terminal_service initialized");

            let db_path = data_dir.join("biosphere.db");
            let notes_dir = data_dir.join("notes");
            let _ = write_debug_log(&debug_log_path, &format!("[setup] db_path: {:?}", db_path));

            let _ = std::fs::create_dir_all(&notes_dir);

            let db = match Database::open(&db_path) {
                Ok(db) => {
                    let _ = write_debug_log(&debug_log_path, "[setup] database opened successfully");
                    db
                }
                Err(e) => {
                    let _ = write_debug_log(&debug_log_path, &format!("[setup] FAILED to open database: {}", e));
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
            let _ = write_debug_log(&debug_log_path, "[setup] all services initialized");

            app_handle.manage(db_arc);
            app_handle.manage(notebook_service);
            app_handle.manage(agent_service);
            app_handle.manage(plugin_service);
            app_handle.manage(linker_service);
            app_handle.manage(command_executor);
            app_handle.manage(icon_service);
            app_handle.manage(remote_desktop_service);
            let _ = write_debug_log(&debug_log_path, "[setup] all services registered with app_handle");

            // Inspect the webview: log if main window exists and its URL.
            // NOTE: During setup the webview URL may still be about:blank because
            // Tauri navigates to the embedded frontend AFTER setup completes.
            // Do NOT manually navigate here – on Windows, navigating to
            // tauri://localhost/ overrides Tauri's own navigation and WebView2
            // does not support the tauri:// scheme (it uses https://tauri.localhost/).
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = write_debug_log(&debug_log_path, "[setup] main webview window found");
                match window.url() {
                    Ok(url) => {
                        let _ = write_debug_log(&debug_log_path, &format!("[setup] main webview URL at setup time: {} (may change after setup)", url));
                    }
                    Err(e) => {
                        let _ = write_debug_log(&debug_log_path, &format!("[setup] FAILED to get main webview URL: {}", e));
                    }
                }

                // Log window properties
                let _ = write_debug_log(&debug_log_path, &format!("[setup] window label: {}", window.label()));
                let _ = write_debug_log(&debug_log_path, &format!("[setup] window is_visible: {}", window.is_visible().unwrap_or(false)));
                let _ = write_debug_log(&debug_log_path, &format!("[setup] window is_decorated: {}", window.is_decorated().unwrap_or(false)));
                if let Ok(size) = window.inner_size() {
                    let _ = write_debug_log(&debug_log_path, &format!("[setup] window inner_size: {}x{}", size.width, size.height));
                }
                if let Ok(pos) = window.outer_position() {
                    let _ = write_debug_log(&debug_log_path, &format!("[setup] window position: ({}, {})", pos.x, pos.y));
                }
            } else {
                let _ = write_debug_log(&debug_log_path, "[setup] WARNING: no main webview window found");
            }

            // Log all available windows
            let all_windows = app_handle.webview_windows();
            let _ = write_debug_log(&debug_log_path, &format!("[setup] total webview windows: {}", all_windows.len()));
            for (label, win) in &all_windows {
                let url_str = win.url().map(|u| u.to_string()).unwrap_or_else(|e| format!("(error: {})", e));
                let _ = write_debug_log(&debug_log_path, &format!("[setup]   window '{}': {}", label, url_str));
            }

            // Log Tauri app info
            let _ = write_debug_log(&debug_log_path, &format!("[setup] app identifier: {}", app_handle.config().identifier));
            let _ = write_debug_log(&debug_log_path, &format!("[setup] app product_name: {:?}", app_handle.config().product_name));
            let _ = write_debug_log(&debug_log_path, &format!("[setup] app version: {:?}", app_handle.config().version));
            if let Some(frontend_dist) = &app_handle.config().build.frontend_dist {
                let _ = write_debug_log(&debug_log_path, &format!("[setup] config frontendDist: {:?}", frontend_dist));
            } else {
                let _ = write_debug_log(&debug_log_path, "[setup] config frontendDist: (not set)");
            }
            if let Some(dev_url) = &app_handle.config().build.dev_url {
                let _ = write_debug_log(&debug_log_path, &format!("[setup] config devUrl: {}", dev_url));
            }
            if let Some(csp) = &app_handle.config().app.security.csp {
                let _ = write_debug_log(&debug_log_path, &format!("[setup] config CSP: {}", csp));
            } else {
                let _ = write_debug_log(&debug_log_path, "[setup] config CSP: (not set)");
            }

            // Delayed check: verify the webview URL after Tauri's own navigation
            // should have completed.  If it is still about:blank, navigate to
            // the platform-correct URL as a fallback.
            // Also inject JS error listeners to capture frontend errors.
            let app_handle_delayed = app_handle.clone();
            let debug_log_path_delayed = debug_log_path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let _ = write_debug_log(&debug_log_path_delayed, "[delayed] checking webview URL after 3s");
                if let Some(window) = app_handle_delayed.get_webview_window("main") {
                    match window.url() {
                        Ok(url) => {
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] webview URL: {}", url));
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] webview scheme: {:?}", url.scheme()));
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] webview host: {:?}", url.host_str()));
                            if url.scheme() == "about" {
                                let _ = write_debug_log(&debug_log_path_delayed, "[delayed] webview still about:blank, attempting platform-specific navigation");
                                let target_url_str = if cfg!(target_os = "windows") {
                                    "https://tauri.localhost/"
                                } else {
                                    "tauri://localhost/"
                                };
                                match tauri::Url::parse(target_url_str) {
                                    Ok(target_url) => {
                                        let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] navigating to: {}", target_url_str));
                                        match window.navigate(target_url) {
                                            Ok(()) => {
                                                let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] navigate to {} succeeded", target_url_str));
                                            }
                                            Err(e) => {
                                                let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] navigate to {} failed: {}", target_url_str, e));
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] failed to parse URL {}: {}", target_url_str, e));
                                    }
                                }
                            } else {
                                let _ = write_debug_log(&debug_log_path_delayed, "[delayed] webview has valid URL, no action needed");
                            }
                        }
                        Err(e) => {
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] failed to get webview URL: {}", e));
                        }
                    }

                    // Inject JS to capture frontend errors and report via Tauri events
                    let _ = write_debug_log(&debug_log_path_delayed, "[delayed] injecting JS error listeners");
                    let js_err = r#"
                        (function(){
                            window.__biosphere_errors = [];
                            window.onerror = function(msg, src, line, col, err) {
                                window.__biosphere_errors.push('onerror: ' + msg + ' at ' + src + ':' + line + ':' + col);
                            };
                            window.addEventListener('unhandledrejection', function(e) {
                                window.__biosphere_errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason || e));
                            });
                            document.addEventListener('securitypolicyviolation', function(e) {
                                window.__biosphere_errors.push('CSP violation: ' + e.violatedDirective + ' blocked ' + e.blockedURI);
                            });
                        })();
                    "#;
                    match window.eval(js_err) {
                        Ok(()) => {
                            let _ = write_debug_log(&debug_log_path_delayed, "[delayed] JS error listeners injected successfully");
                        }
                        Err(e) => {
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] FAILED to inject JS error listeners: {}", e));
                        }
                    }

                    // Inject JS to check DOM content
                    let js_dom = r#"
                        (function(){
                            var bodyLen = document.body ? document.body.innerHTML.length : -1;
                            var scripts = document.querySelectorAll('script');
                            window.__biosphere_dom_info = 'bodyLen=' + bodyLen + ' scripts=' + scripts.length;
                        })();
                    "#;
                    match window.eval(js_dom) {
                        Ok(()) => {
                            let _ = write_debug_log(&debug_log_path_delayed, "[delayed] JS DOM check injected");
                        }
                        Err(e) => {
                            let _ = write_debug_log(&debug_log_path_delayed, &format!("[delayed] FAILED to inject JS DOM check: {}", e));
                        }
                    }

                    // Listen for JS diagnostic events
                    let debug_log_for_listener = debug_log_path_delayed.clone();
                    let _listener_id = app_handle_delayed.listen("js-diagnostic", move |event| {
                        let payload = event.payload().to_string();
                        let _ = write_debug_log(&debug_log_for_listener, &format!("[js-diagnostic] {}", payload));
                    });

                    // Second delayed check after 8s total to collect error info and see final state
                    let window_8s = window;
                    let debug_log_8s = debug_log_path_delayed.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        let _ = write_debug_log(&debug_log_8s, "[delayed-8s] final webview check");

                        match window_8s.url() {
                            Ok(url) => {
                                let _ = write_debug_log(&debug_log_8s, &format!("[delayed-8s] webview URL: {}", url));
                            }
                            Err(e) => {
                                let _ = write_debug_log(&debug_log_8s, &format!("[delayed-8s] failed to get URL: {}", e));
                            }
                        }

                        // Collect JS errors and DOM info via Tauri event
                        let js_collect = r#"
                            (function(){
                                var errs = window.__biosphere_errors || [];
                                var domInfo = window.__biosphere_dom_info || '(not set)';
                                var bodyPreview = document.body ? document.body.innerHTML.substring(0, 500) : '(no body)';
                                var result = 'domInfo=' + domInfo + ' errors=' + errs.length;
                                if(errs.length > 0) {
                                    result += ' | ' + errs.join(' | ');
                                }
                                result += ' | bodyPreview=' + bodyPreview;
                                if(window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
                                    window.__TAURI__.event.emit('js-diagnostic', result);
                                }
                            })();
                        "#;
                        match window_8s.eval(js_collect) {
                            Ok(()) => {
                                let _ = write_debug_log(&debug_log_8s, "[delayed-8s] JS diagnostics collection triggered (result via event)");
                            }
                            Err(e) => {
                                let _ = write_debug_log(&debug_log_8s, &format!("[delayed-8s] FAILED to trigger JS diagnostics: {}", e));
                            }
                        }
                    });
                } else {
                    let _ = write_debug_log(&debug_log_path_delayed, "[delayed] no main webview window found");
                }
            });

            let _ = write_debug_log(&debug_log_path, "[setup] setup completed successfully");
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
        .run(tauri::generate_context!());

    match &result {
        Ok(()) => {
            let _ = write_debug_log(&debug_log_path_for_after, "=== Biosphere Terminal exited cleanly ===");
        }
        Err(e) => {
            let _ = write_debug_log(&debug_log_path_for_after, &format!("=== Biosphere Terminal failed: {} ===", e));
        }
    }

    result.map_err(Into::into)
}

/// Append a line to the debug log next to the executable.
/// Best-effort: ignores errors so it never breaks startup.
fn write_debug_log(path: &std::path::Path, message: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    writeln!(file, "[{}] {}", timestamp, message)?;
    Ok(())
}
