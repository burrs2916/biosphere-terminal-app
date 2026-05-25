#![allow(dead_code)]

use crate::core::error::Result;

pub struct SerialConnection;

impl SerialConnection {
    pub fn new() -> Self {
        SerialConnection
    }

    pub fn connect(&mut self) -> Result<()> {
        Err(crate::core::error::Error::Terminal(
            "Serial connections are not yet implemented".into(),
        ))
    }
}
