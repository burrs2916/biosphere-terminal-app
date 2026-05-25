#![allow(dead_code)]

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Terminal error: {0}")]
    Terminal(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Command error: {0}")]
    Command(String),

    #[error("Profile error: {0}")]
    Profile(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
