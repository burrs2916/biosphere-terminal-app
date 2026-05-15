use crate::core::error::Result;
use crate::core::types::TerminalProfile;
use crate::infra::storage::database::Database;
use crate::infra::storage::profile_repo::ProfileRepo;

pub struct ProfileService;

impl ProfileService {
    pub fn list_profiles(db: &Database) -> Result<Vec<TerminalProfile>> {
        ProfileRepo::list(db)
    }

    pub fn save_profile(db: &Database, profile: &TerminalProfile) -> Result<()> {
        ProfileRepo::save(db, profile)
    }

    pub fn delete_profile(db: &Database, id: &str) -> Result<()> {
        ProfileRepo::delete(db, id)
    }
}
