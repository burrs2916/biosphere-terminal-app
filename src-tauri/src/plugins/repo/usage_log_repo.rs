use rusqlite::params;
use std::sync::Arc;

use crate::infra::storage::database::Database;
use crate::plugins::domain::usage_log::{UsageLogEntry, ExecutionMetrics};

pub struct UsageLogRepo {
    db: Arc<Database>,
}

impl UsageLogRepo {
    pub fn new(db: Arc<Database>) -> Self {
        UsageLogRepo { db }
    }

    pub fn ensure_table(&self) -> Result<(), String> {
        let conn = self.db.conn();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS plugin_usage_logs (
                id TEXT PRIMARY KEY,
                plugin_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                params_summary TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'agent',
                success INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                output_summary TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_usage_logs_plugin_id ON plugin_usage_logs(plugin_id);
            CREATE INDEX IF NOT EXISTS idx_usage_logs_tool_name ON plugin_usage_logs(tool_name);
            CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON plugin_usage_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_usage_logs_success ON plugin_usage_logs(success);"
        ).map_err(|e| e.to_string())?;

        let _ = conn.execute_batch(
            "ALTER TABLE plugin_usage_logs ADD COLUMN output_summary TEXT;"
        );

        Ok(())
    }

    pub fn insert(&self, entry: &UsageLogEntry) -> Result<(), String> {
        let conn = self.db.conn();
        let success = if entry.success { 1 } else { 0 };
        conn.execute(
            "INSERT INTO plugin_usage_logs (id, plugin_id, tool_name, params_summary, source, success, duration_ms, error_message, output_summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![entry.id, entry.plugin_id, entry.tool_name, entry.params_summary, entry.source, success, entry.duration_ms, entry.error_message, entry.output_summary, entry.created_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_metrics(&self, plugin_id: &str) -> Result<ExecutionMetrics, String> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) as total,
                    COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) as success_count,
                    COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as fail_count,
                    COALESCE(AVG(duration_ms), 0) as avg_duration,
                    COALESCE(MAX(created_at), 0) as last_executed
             FROM plugin_usage_logs WHERE plugin_id = ?1"
        ).map_err(|e| e.to_string())?;

        let metrics = stmt.query_row(params![plugin_id], |row| {
            Ok(ExecutionMetrics {
                plugin_id: plugin_id.to_string(),
                total_executions: row.get(0)?,
                success_count: row.get::<_, i64>(1)?,
                fail_count: row.get::<_, i64>(2)?,
                avg_duration_ms: row.get::<_, f64>(3)?,
                last_executed_at: row.get::<_, i64>(4)?,
            })
        }).map_err(|e| e.to_string())?;

        Ok(metrics)
    }

    pub fn list_by_plugin(&self, plugin_id: &str, limit: i64) -> Result<Vec<UsageLogEntry>, String> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, plugin_id, tool_name, params_summary, source, success, duration_ms, error_message, output_summary, created_at
             FROM plugin_usage_logs WHERE plugin_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![plugin_id, limit], |row| {
            let success: i32 = row.get(5)?;
            Ok(UsageLogEntry {
                id: row.get(0)?,
                plugin_id: row.get(1)?,
                tool_name: row.get(2)?,
                params_summary: row.get(3)?,
                source: row.get(4)?,
                success: success != 0,
                duration_ms: row.get(6)?,
                error_message: row.get(7)?,
                output_summary: row.get(8)?,
                created_at: row.get(9)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_recent_fail_count(&self, plugin_id: &str, since_ms: i64) -> Result<usize, String> {
        let conn = self.db.conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM plugin_usage_logs WHERE plugin_id = ?1 AND success = 0 AND created_at >= ?2",
            params![plugin_id, since_ms],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        Ok(count as usize)
    }

    pub fn get_common_errors(&self, plugin_id: &str, limit: i64) -> Result<Vec<String>, String> {
        let conn = self.db.conn();
        let mut stmt = conn.prepare(
            "SELECT error_message, COUNT(*) as cnt FROM plugin_usage_logs
             WHERE plugin_id = ?1 AND success = 0 AND error_message IS NOT NULL
             GROUP BY error_message ORDER BY cnt DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![plugin_id, limit], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn clear_by_plugin(&self, plugin_id: &str) -> Result<usize, String> {
        let conn = self.db.conn();
        conn.execute(
            "DELETE FROM plugin_usage_logs WHERE plugin_id = ?1",
            params![plugin_id],
        ).map_err(|e| e.to_string()).map(|n| n as usize)
    }

}
