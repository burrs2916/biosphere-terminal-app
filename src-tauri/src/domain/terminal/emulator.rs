#![allow(dead_code)]

pub struct TerminalEmulator {
    rows: u16,
    cols: u16,
}

impl TerminalEmulator {
    pub fn new(rows: u16, cols: u16) -> Self {
        TerminalEmulator { rows, cols }
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.rows = rows;
        self.cols = cols;
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    pub fn cols(&self) -> u16 {
        self.cols
    }
}
