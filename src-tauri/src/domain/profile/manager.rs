#![allow(dead_code)]

use crate::core::error::Result;
use crate::core::types::TerminalProfile;
use std::collections::HashMap;

pub struct ProfileManager {
    profiles: HashMap<String, TerminalProfile>,
}

impl ProfileManager {
    pub fn new() -> Self {
        ProfileManager {
            profiles: HashMap::new(),
        }
    }

    pub fn add(&mut self, profile: TerminalProfile) -> Result<()> {
        self.profiles.insert(profile.id.clone(), profile);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.profiles.remove(id);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&TerminalProfile> {
        self.profiles.get(id)
    }

    pub fn list(&self) -> Vec<&TerminalProfile> {
        self.profiles.values().collect()
    }

    pub fn get_default(&self) -> Option<&TerminalProfile> {
        self.profiles.values().find(|p| p.is_default)
    }
}
