#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum TerminalEvent {
    #[serde(rename = "terminal:output")]
    TerminalOutput {
        session_id: String,
        data: String,
    },
    #[serde(rename = "terminal:closed")]
    TerminalClosed {
        session_id: String,
        exit_code: Option<i32>,
    },
    #[serde(rename = "terminal:error")]
    TerminalError {
        session_id: String,
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SessionEvent {
    #[serde(rename = "session:created")]
    SessionCreated {
        session_id: String,
        name: String,
    },
    #[serde(rename = "session:closed")]
    SessionClosed {
        session_id: String,
    },
    #[serde(rename = "session:updated")]
    SessionUpdated {
        session_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum CommandEvent {
    #[serde(rename = "command:executed")]
    CommandExecuted {
        session_id: String,
        command: String,
        exit_code: Option<i32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AppEvent {
    Terminal(TerminalEvent),
    Session(SessionEvent),
    Command(CommandEvent),
}
