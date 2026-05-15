#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitLayout {
    pub direction: SplitDirection,
    pub children: Vec<LayoutNode>,
    pub sizes: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LayoutNode {
    Pane { session_id: String },
    Split(Box<SplitLayout>),
}

impl Default for SplitLayout {
    fn default() -> Self {
        SplitLayout {
            direction: SplitDirection::Vertical,
            children: vec![],
            sizes: vec![],
        }
    }
}
