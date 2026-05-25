#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = biosphere_terminal_app_lib::run() {
        eprintln!("error while running tauri application: {}", e);
        std::process::exit(1);
    }
}
