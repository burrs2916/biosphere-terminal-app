#![allow(dead_code)]

use crate::core::types::TerminalProfile;

pub struct ProfileResolver;

impl ProfileResolver {
    pub fn new() -> Self {
        ProfileResolver
    }

    pub fn resolve(&self, _profile: &TerminalProfile) -> TerminalProfile {
        _profile.clone()
    }
}
