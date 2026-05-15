#![allow(dead_code)]

use std::collections::HashMap;

pub struct AliasManager {
    aliases: HashMap<String, String>,
}

impl AliasManager {
    pub fn new() -> Self {
        AliasManager {
            aliases: HashMap::new(),
        }
    }

    pub fn set(&mut self, name: String, command: String) {
        self.aliases.insert(name, command);
    }

    pub fn get(&self, name: &str) -> Option<&String> {
        self.aliases.get(name)
    }

    pub fn remove(&mut self, name: &str) {
        self.aliases.remove(name);
    }

    pub fn list(&self) -> &HashMap<String, String> {
        &self.aliases
    }

    pub fn resolve(&self, command: &str) -> String {
        self.aliases.get(command).cloned().unwrap_or_else(|| command.to_string())
    }
}
