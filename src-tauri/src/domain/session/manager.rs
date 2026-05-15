#![allow(dead_code)]

use crate::core::error::Result;
use crate::core::types::TerminalSession;
use std::collections::HashMap;

pub struct SessionManager {
    sessions: HashMap<String, TerminalSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        SessionManager {
            sessions: HashMap::new(),
        }
    }

    pub fn create(&mut self, session: TerminalSession) -> Result<()> {
        self.sessions.insert(session.id.clone(), session);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.sessions.remove(id);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&TerminalSession> {
        self.sessions.get(id)
    }

    pub fn list(&self) -> Vec<&TerminalSession> {
        self.sessions.values().collect()
    }

    pub fn update(&mut self, session: TerminalSession) -> Result<()> {
        self.sessions.insert(session.id.clone(), session);
        Ok(())
    }
}
