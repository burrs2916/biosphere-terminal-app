#![allow(dead_code)]

pub struct ScrollBuffer {
    lines: Vec<String>,
    max_lines: usize,
}

impl ScrollBuffer {
    pub fn new(max_lines: usize) -> Self {
        ScrollBuffer {
            lines: Vec::new(),
            max_lines,
        }
    }

    pub fn push(&mut self, line: String) {
        self.lines.push(line);
        if self.lines.len() > self.max_lines {
            self.lines.remove(0);
        }
    }

    pub fn get_lines(&self) -> &[String] {
        &self.lines
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }
}
