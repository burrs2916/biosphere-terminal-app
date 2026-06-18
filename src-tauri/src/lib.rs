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
use app::licensing::LicensingService;
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

type DebugLogPaths = std::sync::Arc<Vec<std::path::PathBuf>>;

/// Writable log locations (AppData first, exe dir as fallback).
fn resolve_debug_log_paths(exe_path: &Option<std::path::PathBuf>) -> DebugLogPaths {
    let mut paths = Vec::new();

    if let Some(local) = dirs_next::data_local_dir() {
        paths.push(
            local
                .join("BURRS.biosphere-ai-terminal")
                .join("debug.log"),
        );
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = std::path::PathBuf::from(appdata)
            .join("BURRS.biosphere-ai-terminal")
            .join("debug.log");
        if !paths.contains(&p) {
            paths.push(p);
        }
    }
    if cfg!(debug_assertions) {
        paths.push(get_dev_log_dir().join("debug.log"));
    }
    if let Some(exe) = exe_path.as_ref().and_then(|p| p.parent()) {
        let exe_log = exe.join("debug.log");
        if !paths.contains(&exe_log) {
            paths.push(exe_log);
        }
    }
    if paths.is_empty() {
        paths.push(std::path::PathBuf::from("debug.log"));
    }

    std::sync::Arc::new(paths)
}

fn write_debug_log_all(paths: &DebugLogPaths, message: &str) {
    for path in paths.iter() {
        let _ = write_debug_log(path, message);
    }
}

fn install_panic_hook(paths: DebugLogPaths) {
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("[panic] {}", info);
        write_debug_log_all(&paths, &msg);
        eprintln!("{msg}");
    }));
}

const JS_ERROR_HOOKS: &str = r#"
(function(){
    if (window.__biosphere_hooks_installed) return;
    window.__biosphere_hooks_installed = true;
    window.__biosphere_errors = window.__biosphere_errors || [];
    window.onerror = function(msg, src, line, col, err) {
        var entry = 'onerror: ' + msg + ' at ' + src + ':' + line + ':' + col;
        if (err && err.stack) entry += ' stack=' + err.stack;
        window.__biosphere_errors.push(entry);
    };
    window.addEventListener('unhandledrejection', function(e) {
        window.__biosphere_errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason || e));
    });
    document.addEventListener('securitypolicyviolation', function(e) {
        window.__biosphere_errors.push('CSP violation: ' + e.violatedDirective + ' blocked ' + e.blockedURI);
    });
    Array.from(document.querySelectorAll('script[src]')).forEach(function(node, index) {
        node.addEventListener('error', function() {
            window.__biosphere_errors.push('script.load.failed[' + index + ']=' + (node.src || node.getAttribute('src')));
        });
    });
})();
"#;

const JS_COLLECT_SNAPSHOT: &str = r#"
(function(){
    var errs = window.__biosphere_errors || [];
    var scripts = Array.from(document.querySelectorAll('script')).map(function(s, i) {
        return i + ':' + (s.src || s.getAttribute('src') || 'inline') + ' type=' + (s.type || '');
    }).join('; ');
    var styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function(l) {
        return l.href;
    }).join('; ');
    var root = document.getElementById('root');
    var payload = {
        href: String(location.href),
        readyState: String(document.readyState),
        title: String(document.title),
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        rootChildren: root ? root.childElementCount : -1,
        rootInnerLen: root ? root.innerHTML.length : -1,
        scriptCount: document.querySelectorAll('script').length,
        scripts: scripts,
        stylesheets: styles,
        errorCount: errs.length,
        errors: errs,
        userAgent: String(navigator.userAgent),
        hasTauriInternals: !!window.__TAURI_INTERNALS__,
        hasTauriGlobal: !!window.__TAURI__
    };
    var msg = JSON.stringify(payload);
    window.__biosphere_last_diag = msg;
    try {
        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
            window.__TAURI_INTERNALS__.invoke('write_frontend_log', {
                level: 'info',
                tag: 'js-snapshot',
                message: msg
            });
        }
    } catch (e) {
        window.__biosphere_errors.push('invoke.write_frontend_log.failed: ' + e);
    }
    return msg;
})();
"#;

fn eval_webview_snapshot(
    window: &tauri::WebviewWindow,
    paths: &DebugLogPaths,
    label: &str,
) {
    match window.eval(JS_COLLECT_SNAPSHOT) {
        Ok(()) => {
            write_debug_log_all(paths, &format!("[{label}] JS snapshot eval submitted (see js-snapshot in logs)"));
        }
        Err(e) => {
            write_debug_log_all(paths, &format!("[{label}] FAILED JS snapshot eval: {e}"));
        }
    }
}

fn inject_js_error_hooks(
    window: &tauri::WebviewWindow,
    paths: &DebugLogPaths,
    label: &str,
) {
    match window.eval(JS_ERROR_HOOKS) {
        Ok(()) => write_debug_log_all(paths, &format!("[{label}] JS error hooks injected")),
        Err(e) => write_debug_log_all(paths, &format!("[{label}] FAILED to inject JS error hooks: {e}")),
    }
}

fn log_webview_state(
    window: &tauri::WebviewWindow,
    paths: &DebugLogPaths,
    label: &str,
) {
    write_debug_log_all(
        paths,
        &format!("[{label}] window label={}", window.label()),
    );
    write_debug_log_all(
        paths,
        &format!(
            "[{label}] window visible={} decorated={}",
            window.is_visible().unwrap_or(false),
            window.is_decorated().unwrap_or(false)
        ),
    );
    if let Ok(size) = window.inner_size() {
        write_debug_log_all(
            paths,
            &format!("[{label}] window inner_size={}x{}", size.width, size.height),
        );
    }
    match window.url() {
        Ok(url) => {
            write_debug_log_all(paths, &format!("[{label}] webview URL: {url}"));
            write_debug_log_all(paths, &format!("[{label}] webview scheme: {:?}", url.scheme()));
            write_debug_log_all(paths, &format!("[{label}] webview host: {:?}", url.host_str()));
        }
        Err(e) => write_debug_log_all(paths, &format!("[{label}] failed to get webview URL: {e}")),
    }
}

fn maybe_navigate_from_blank(
    window: &tauri::WebviewWindow,
    paths: &DebugLogPaths,
    label: &str,
) {
    let Ok(url) = window.url() else {
        return;
    };
    if url.scheme() != "about" {
        write_debug_log_all(paths, &format!("[{label}] webview has non-blank URL, no navigation needed"));
        return;
    }

    let target_url_str = if cfg!(target_os = "windows") {
        "https://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    write_debug_log_all(
        paths,
        &format!("[{label}] webview still about:blank, navigating to {target_url_str}"),
    );
    match tauri::Url::parse(target_url_str) {
        Ok(target_url) => match window.navigate(target_url) {
            Ok(()) => write_debug_log_all(paths, &format!("[{label}] navigate to {target_url_str} succeeded")),
            Err(e) => write_debug_log_all(paths, &format!("[{label}] navigate to {target_url_str} failed: {e}")),
        },
        Err(e) => write_debug_log_all(
            paths,
            &format!("[{label}] failed to parse URL {target_url_str}: {e}"),
        ),
    }
}

fn spawn_webview_diagnostics(app_handle: tauri::AppHandle, paths: DebugLogPaths) {
    let schedules: &[(u64, &str)] = &[
        (0, "immediate"),
        (1, "1s"),
        (3, "3s"),
        (8, "8s"),
        (15, "15s"),
    ];

    for (secs, label) in schedules {
        let app = app_handle.clone();
        let paths = paths.clone();
        let wait = *secs;
        let tag = *label;
        std::thread::spawn(move || {
            if wait > 0 {
                std::thread::sleep(std::time::Duration::from_secs(wait));
            }
            write_debug_log_all(&paths, &format!("[diag-{tag}] webview diagnostic check"));
            let Some(window) = app.get_webview_window("main") else {
                write_debug_log_all(&paths, &format!("[diag-{tag}] no main webview window"));
                return;
            };

            log_webview_state(&window, &paths, &format!("diag-{tag}"));
            inject_js_error_hooks(&window, &paths, &format!("diag-{tag}"));
            if wait >= 3 {
                maybe_navigate_from_blank(&window, &paths, &format!("diag-{tag}"));
            }
            eval_webview_snapshot(&window, &paths, &format!("diag-{tag}"));
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let exe_path = std::env::current_exe().ok();
    let debug_paths = resolve_debug_log_paths(&exe_path);
    install_panic_hook(debug_paths.clone());

    write_debug_log_all(
        &debug_paths,
        "=== Biosphere Terminal started ===",
    );
    let _ = write_debug_log_all(&debug_paths, &format!("exe: {:?}", exe_path));
    let _ = write_debug_log_all(&debug_paths, &format!("args: {:?}", std::env::args().collect::<Vec<_>>()));
    let _ = write_debug_log_all(&debug_paths, &format!("cwd: {:?}", std::env::current_dir().ok()));
    for path in debug_paths.iter() {
        let _ = write_debug_log_all(&debug_paths, &format!("debug.log path: {:?}", path));
    }

    // ---- System & Environment diagnostics ----
    let _ = write_debug_log_all(&debug_paths, &format!("os: {}", std::env::consts::OS));
    let _ = write_debug_log_all(&debug_paths, &format!("arch: {}", std::env::consts::ARCH));
    let _ = write_debug_log_all(&debug_paths, &format!("family: {}", std::env::consts::FAMILY));

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
                    let _ = write_debug_log_all(&debug_paths, &format!("env {} = {}...", truncated, if val.len() > 300 { " (truncated)" } else { "" }));
                } else {
                    let _ = write_debug_log_all(&debug_paths, &format!("env {} = {}", key, val));
                }
            }
            Err(_) => {
                let _ = write_debug_log_all(&debug_paths, &format!("env {} = (not set)", key));
            }
        }
    }

    // On Windows: check WebView2 Runtime availability
    #[cfg(target_os = "windows")]
    {
        let _ = write_debug_log_all(&debug_paths, "[diag] checking WebView2 Runtime...");
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
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] WebView2/Edge found at: {:?}", p));
                // Try to list subdirectories (version folders)
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with(|c: char| c.is_ascii_digit()) {
                            let _ = write_debug_log_all(&debug_paths, &format!("[diag]   version dir: {}", name));
                        }
                    }
                }
            } else {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] WebView2/Edge NOT found at: {:?}", p));
            }
        }

        // Check registry for WebView2 version
        let _ = write_debug_log_all(&debug_paths, "[diag] checking registry for WebView2...");
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKLM WOW6432Node stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKLM WOW6432Node stderr: {}", stderr.trim()));
            }
        }
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKLM stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKLM stderr: {}", stderr.trim()));
            }
        }
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-22B8B6B3A6D1}", "/v", "pv"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKCU stdout: {}", stdout.trim()));
            if !stderr.trim().is_empty() {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] reg query HKCU stderr: {}", stderr.trim()));
            }
        }

        // Check if msedgewebview2.exe exists in PATH or common locations
        if let Ok(output) = std::process::Command::new("where")
            .arg("msedgewebview2.exe")
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !stdout.trim().is_empty() {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] msedgewebview2.exe found: {}", stdout.trim()));
            } else {
                let _ = write_debug_log_all(&debug_paths, "[diag] msedgewebview2.exe NOT found in PATH");
            }
        }
    }

    // Check if the exe directory is writable (for debug.log itself)
    if let Some(exe_dir) = exe_path.as_ref().and_then(|p| p.parent()) {
        let test_file = exe_dir.join(".biosphere_write_test");
        match std::fs::write(&test_file, b"test") {
            Ok(()) => {
                let _ = std::fs::remove_file(&test_file);
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] exe directory is writable: {:?}", exe_dir));
            }
            Err(e) => {
                let _ = write_debug_log_all(&debug_paths, &format!("[diag] exe directory is NOT writable: {:?} ({})", exe_dir, e));
            }
        }
    }

    let debug_paths_for_setup = debug_paths.clone();
    let debug_paths_for_after = debug_paths.clone();

    let terminal_service = Arc::new(TerminalService::new());

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal_service.clone())
        .setup(move |app| {
            let app_handle = app.handle();
            let debug_paths = debug_paths_for_setup.clone();
            let _ = write_debug_log_all(&debug_paths, "[setup] Tauri setup started");

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

            let _ = write_debug_log_all(&debug_paths, &format!("[setup] data_dir: {:?}", data_dir));
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] log_dir: {:?}", log_dir));

            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("Warning: could not create data dir {:?}: {}", data_dir, e);
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] FAILED to create data dir: {}", e));
            }
            if let Err(e) = std::fs::create_dir_all(&log_dir) {
                eprintln!("Warning: could not create log dir {:?}: {}", log_dir, e);
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] FAILED to create log dir: {}", e));
            }

            infra::logging::init(&log_dir);
            let _ = write_debug_log_all(&debug_paths, "[setup] logging initialized");

            tracing::info!("[app] data directory: {:?}", data_dir);
            tracing::info!("[app] log directory: {:?}", log_dir);
            for path in debug_paths.iter() {
                tracing::info!("[app] debug log path: {:?}", path);
            }

            terminal_service.set_app_handle(app_handle.clone())?;
            let _ = write_debug_log_all(&debug_paths, "[setup] terminal_service initialized");

            let db_path = data_dir.join("biosphere.db");
            let notes_dir = data_dir.join("notes");
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] db_path: {:?}", db_path));

            let _ = std::fs::create_dir_all(&notes_dir);

            let db = match Database::open(&db_path) {
                Ok(db) => {
                    let _ = write_debug_log_all(&debug_paths, "[setup] database opened successfully");
                    db
                }
                Err(e) => {
                    let _ = write_debug_log_all(&debug_paths, &format!("[setup] FAILED to open database: {}", e));
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
            let licensing_service = Arc::new(LicensingService::new(data_dir.clone()));
            let _ = write_debug_log_all(&debug_paths, "[setup] all services initialized");

            // 启动后异步与 Microsoft Store 同步 entitlement，防止本地缓存被人工编辑。
            // 仅 Windows 平台有意义，其他平台是 no-op。
            {
                let licensing_for_sync = licensing_service.clone();
                tauri::async_runtime::spawn(async move {
                    licensing_for_sync.sync_with_store().await;
                });
            }

            app_handle.manage(db_arc);
            app_handle.manage(notebook_service);
            app_handle.manage(agent_service);
            app_handle.manage(plugin_service);
            app_handle.manage(linker_service);
            app_handle.manage(command_executor);
            app_handle.manage(icon_service);
            app_handle.manage(remote_desktop_service);
            app_handle.manage(licensing_service);
            let _ = write_debug_log_all(&debug_paths, "[setup] all services registered with app_handle");

            // Inspect the webview: log if main window exists and its URL.
            // NOTE: During setup the webview URL may still be about:blank because
            // Tauri navigates to the embedded frontend AFTER setup completes.
            // Do NOT manually navigate here – on Windows, navigating to
            // tauri://localhost/ overrides Tauri's own navigation and WebView2
            // does not support the tauri:// scheme (it uses https://tauri.localhost/).
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = write_debug_log_all(&debug_paths, "[setup] main webview window found");
                match window.url() {
                    Ok(url) => {
                        let _ = write_debug_log_all(&debug_paths, &format!("[setup] main webview URL at setup time: {} (may change after setup)", url));
                    }
                    Err(e) => {
                        let _ = write_debug_log_all(&debug_paths, &format!("[setup] FAILED to get main webview URL: {}", e));
                    }
                }

                // Log window properties
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] window label: {}", window.label()));
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] window is_visible: {}", window.is_visible().unwrap_or(false)));
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] window is_decorated: {}", window.is_decorated().unwrap_or(false)));
                if let Ok(size) = window.inner_size() {
                    let _ = write_debug_log_all(&debug_paths, &format!("[setup] window inner_size: {}x{}", size.width, size.height));
                }
                if let Ok(pos) = window.outer_position() {
                    let _ = write_debug_log_all(&debug_paths, &format!("[setup] window position: ({}, {})", pos.x, pos.y));
                }
            } else {
                let _ = write_debug_log_all(&debug_paths, "[setup] WARNING: no main webview window found");
            }

            // Log all available windows
            let all_windows = app_handle.webview_windows();
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] total webview windows: {}", all_windows.len()));
            for (label, win) in &all_windows {
                let url_str = win.url().map(|u| u.to_string()).unwrap_or_else(|e| format!("(error: {})", e));
                let _ = write_debug_log_all(&debug_paths, &format!("[setup]   window '{}': {}", label, url_str));
            }

            // Log Tauri app info
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] app identifier: {}", app_handle.config().identifier));
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] app product_name: {:?}", app_handle.config().product_name));
            let _ = write_debug_log_all(&debug_paths, &format!("[setup] app version: {:?}", app_handle.config().version));
            if let Some(frontend_dist) = &app_handle.config().build.frontend_dist {
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] config frontendDist: {:?}", frontend_dist));
            } else {
                let _ = write_debug_log_all(&debug_paths, "[setup] config frontendDist: (not set)");
            }
            if let Some(dev_url) = &app_handle.config().build.dev_url {
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] config devUrl: {}", dev_url));
            }
            if let Some(csp) = &app_handle.config().app.security.csp {
                let _ = write_debug_log_all(&debug_paths, &format!("[setup] config CSP: {}", csp));
            } else {
                let _ = write_debug_log_all(&debug_paths, "[setup] config CSP: (not set)");
            }

            // Mirror frontend diagnostic events into debug.log and tracing.
            let debug_paths_listener = debug_paths.clone();
            let _frontend_diag_listener = app_handle.listen("frontend-diagnostic", move |event| {
                let payload = event.payload().to_string();
                write_debug_log_all(&debug_paths_listener, &format!("[frontend-diagnostic] {payload}"));
                tracing::info!("[frontend-diagnostic] {payload}");
            });
            let debug_paths_js_listener = debug_paths.clone();
            let _js_diag_listener = app_handle.listen("js-diagnostic", move |event| {
                let payload = event.payload().to_string();
                write_debug_log_all(&debug_paths_js_listener, &format!("[js-diagnostic] {payload}"));
                tracing::info!("[js-diagnostic] {payload}");
            });

            if let Some(window) = app_handle.get_webview_window("main") {
                inject_js_error_hooks(&window, &debug_paths, "setup-immediate");
            }

            spawn_webview_diagnostics(app_handle.clone(), debug_paths.clone());

            let _ = write_debug_log_all(&debug_paths, "[setup] setup completed successfully");
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
            interface::commands::licensing::check_pro_status,
            interface::commands::licensing::purchase_pro_lifetime,
            interface::commands::licensing::restore_pro_license,
            interface::commands::licensing::reset_license,
            interface::commands::licensing::extend_trial,
            interface::commands::licensing::get_pro_product_id,
        ])
        .run(tauri::generate_context!());

    match &result {
        Ok(()) => {
            write_debug_log_all(&debug_paths_for_after, "=== Biosphere Terminal exited cleanly ===");
        }
        Err(e) => {
            write_debug_log_all(
                &debug_paths_for_after,
                &format!("=== Biosphere Terminal failed: {e} ==="),
            );
        }
    }

    result.map_err(Into::into)
}

/// Append a line to a single debug log file.
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
