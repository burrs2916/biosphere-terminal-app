#![allow(dead_code)]

use crate::core::error::Result;
use crate::core::types::SshConnectionInfo;

pub struct SshConnection {
    info: SshConnectionInfo,
    connected: bool,
}

impl SshConnection {
    pub fn new(info: SshConnectionInfo) -> Self {
        SshConnection {
            info,
            connected: false,
        }
    }

    pub fn connect(&mut self) -> Result<()> {
        Err(crate::core::error::Error::Terminal(
            "SSH connections are not yet implemented".into(),
        ))
    }

    pub fn disconnect(&mut self) -> Result<()> {
        self.connected = false;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    pub fn info(&self) -> &SshConnectionInfo {
        &self.info
    }
}
