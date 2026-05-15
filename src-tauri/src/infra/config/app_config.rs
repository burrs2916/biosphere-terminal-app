#![allow(dead_code)]

pub struct AppConfig {
    pub data_dir: std::path::PathBuf,
}

impl AppConfig {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        AppConfig { data_dir }
    }
}
