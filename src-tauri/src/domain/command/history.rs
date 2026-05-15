#![allow(dead_code)]

use crate::core::types::CommandHistoryEntry;
use std::collections::VecDeque;

pub struct CommandHistory {
    entries: VecDeque<CommandHistoryEntry>,
    max_size: usize,
}

impl CommandHistory {
    pub fn new(max_size: usize) -> Self {
        CommandHistory {
            entries: VecDeque::new(),
            max_size,
        }
    }

    pub fn push(&mut self, entry: CommandHistoryEntry) {
        if self.entries.len() >= self.max_size {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn search(&self, query: &str) -> Vec<&CommandHistoryEntry> {
        self.entries
            .iter()
            .filter(|e| e.command.contains(query))
            .collect()
    }

    pub fn list(&self) -> Vec<&CommandHistoryEntry> {
        self.entries.iter().collect()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}
