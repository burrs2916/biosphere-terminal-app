//! Shared `debug.log` sink.
//!
//! `debug.log` is a plain-text, session-scoped diagnostics file that is
//! **independent of the `tracing` pipeline** (which writes `biosphere.log`).
//! It is truncated at every startup and is the file users are asked to attach
//! when reporting a bug, so it must stay readable and self-contained.
//!
//! Historically only `lib.rs` could write to it (bootstrap / webview / panic
//! diagnostics) because the resolved paths lived in a local variable. This
//! module lifts the paths into a process-global registry so any layer
//! (services, commands, and the frontend via an IPC command) can append to the
//! same file, which is what makes an end-to-end trace of a multi-step,
//! frontend-driven workflow — such as the Remote Desktop setup guide — possible.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

/// Maximum size of debug.log before it gets truncated in-place.
/// 5 MB is enough for a full session of diagnostics without bloating disk.
pub const DEBUG_LOG_MAX_SIZE: u64 = 5 * 1024 * 1024;

/// Hard cap for a single detail payload. Remote command output can be
/// arbitrarily large; truncating per-entry keeps one noisy command from
/// evicting the rest of the session via the 5 MB rotation.
const MAX_DETAIL_LEN: usize = 8192;

pub type DebugLogPaths = Arc<Vec<PathBuf>>;

static PATHS: OnceLock<DebugLogPaths> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Register the resolved debug.log locations for process-global writes.
/// Called once from `run()`; later calls are ignored.
pub fn init_paths(paths: DebugLogPaths) {
    let _ = PATHS.set(paths);
}

/// Append a line to a single debug log file.
/// Best-effort: ignores errors so it never breaks startup.
/// If the file exceeds `DEBUG_LOG_MAX_SIZE`, it is truncated to empty
/// before writing, preventing unbounded growth during a single session.
pub fn write_line(path: &Path, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Check file size; truncate if it has grown too large.
    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.len() >= DEBUG_LOG_MAX_SIZE {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path);
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    writeln!(file, "[{}] {}", timestamp, message)?;
    Ok(())
}

/// Append to every registered location of an explicit path set.
pub fn write_to(paths: &DebugLogPaths, message: &str) {
    for path in paths.iter() {
        let _ = write_line(path, message);
    }
}

/// Append to the process-global debug.log locations.
/// No-op (apart from stderr in debug builds) before `init_paths` has run.
pub fn write(message: &str) {
    match PATHS.get() {
        Some(paths) => write_to(paths, message),
        None => {
            #[cfg(debug_assertions)]
            eprintln!("[debug_log:uninitialized] {message}");
        }
    }
}

/// Monotonic, process-wide sequence number.
///
/// Frontend and backend entries interleave in a single file and the second-
/// resolution prefix of `write_line` cannot order them. The sequence number
/// gives an unambiguous total order for reconstructing a run.
pub fn next_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::Relaxed)
}

/// Wall-clock time with millisecond precision, for correlating an entry with
/// what the user saw on screen.
fn now_hms_millis() -> String {
    chrono::Local::now().format("%H:%M:%S%.3f").to_string()
}

/// Collapse newlines/tabs so one logical entry stays on one physical line.
/// Multi-line shell scripts and remote command output would otherwise break
/// line-oriented tooling (`grep`, `tail -f`) used to read this file.
pub fn one_line(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

/// Truncate an over-long payload, keeping the length visible so a reader can
/// tell the difference between "empty output" and "output elided".
///
/// `max` is counted in `char`s, never bytes: remote output is frequently
/// non-ASCII and byte slicing would panic on a multi-byte boundary.
pub fn clamp(value: &str, max: usize) -> String {
    let total = value.chars().count();
    if total <= max {
        return value.to_string();
    }
    let head: String = value.chars().take(max).collect();
    format!("{head}…<truncated, total {total} chars>")
}

/// Replace every occurrence of a secret with a fixed mask.
///
/// The setup guide moves SSH and VNC passwords through commands and PTY
/// buffers. Those strings must never reach disk: debug.log is explicitly
/// meant to be shared with support.
pub fn redact(value: &str, secrets: &[&str]) -> String {
    let mut out = value.to_string();
    for secret in secrets {
        if secret.len() < 3 {
            // Too short to match reliably; masking it would mangle unrelated text.
            continue;
        }
        if out.contains(secret) {
            out = out.replace(secret, "***REDACTED***");
        }
    }
    out
}

/// Describe a secret without revealing it (presence + length only).
pub fn secret_shape(secret: Option<&str>) -> String {
    match secret {
        Some(s) if !s.is_empty() => format!("set(len={})", s.chars().count()),
        Some(_) => "empty".to_string(),
        None => "none".to_string(),
    }
}

/// One structured entry in the shared trace format.
///
/// Format (after the `[unix_secs]` prefix added by `write_line`):
/// `[scope] #000123 12:34:56.789 LEVEL src=be run=<id> phase=<p> evt=<e> | <detail>`
///
/// Fixed-width sequence and level keep columns aligned, and every field is a
/// `key=value` token so entries can be filtered with plain `grep`.
pub fn structured(
    scope: &str,
    level: &str,
    source: &str,
    run_id: &str,
    phase: &str,
    event: &str,
    detail: &str,
) {
    write(&format_entry(
        scope,
        next_seq(),
        &now_hms_millis(),
        level,
        source,
        run_id,
        phase,
        event,
        detail,
    ));
}

/// Pure formatter behind [`structured`], split out so the on-disk shape of an
/// entry is covered by tests instead of only by inspection.
#[allow(clippy::too_many_arguments)]
fn format_entry(
    scope: &str,
    seq: u64,
    time: &str,
    level: &str,
    source: &str,
    run_id: &str,
    phase: &str,
    event: &str,
    detail: &str,
) -> String {
    format!(
        "[{scope}] #{seq:06} {time} {level:<5} src={source} run={run} phase={phase} evt={event} | {detail}",
        run = if run_id.is_empty() { "-" } else { run_id },
        phase = if phase.is_empty() { "-" } else { phase },
        detail = one_line(&clamp(detail, MAX_DETAIL_LEN)),
    )
}

/// Scope tag for the Remote Desktop setup guide trace.
pub const RD_SCOPE: &str = "rd-guide";

/// Backend-side entry of the Remote Desktop setup guide trace.
pub fn rd(level: &str, run_id: &str, phase: &str, event: &str, detail: &str) {
    structured(RD_SCOPE, level, "be", run_id, phase, event, detail);
}

/// Frontend-side entry (bridged through the `append_remote_desktop_log` command).
pub fn rd_frontend(level: &str, run_id: &str, phase: &str, event: &str, detail: &str) {
    structured(RD_SCOPE, level, "fe", run_id, phase, event, detail);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_line_escapes_control_characters() {
        assert_eq!(one_line("a\nb\tc\rd"), "a\\nb\\tc\\rd");
    }

    #[test]
    fn redact_masks_secret_occurrences() {
        let masked = redact("printf 'hunter2' | vncpasswd -f", &["hunter2"]);
        assert!(!masked.contains("hunter2"));
        assert!(masked.contains("***REDACTED***"));
    }

    #[test]
    fn redact_ignores_too_short_secrets() {
        // A 2-char secret would match everywhere and destroy the log's meaning.
        let masked = redact("ls -la /var", &["la"]);
        assert_eq!(masked, "ls -la /var");
    }

    #[test]
    fn secret_shape_never_leaks_the_value() {
        let shape = secret_shape(Some("hunter2"));
        assert_eq!(shape, "set(len=7)");
        assert!(!shape.contains("hunter2"));
    }

    #[test]
    fn clamp_marks_truncation_and_keeps_total_length() {
        let long = "x".repeat(MAX_DETAIL_LEN + 10);
        let clamped = clamp(&long, MAX_DETAIL_LEN);
        assert!(clamped.contains("truncated"));
        assert!(clamped.contains(&(MAX_DETAIL_LEN + 10).to_string()));
    }

    #[test]
    fn clamp_leaves_short_payloads_untouched() {
        assert_eq!(clamp("short", MAX_DETAIL_LEN), "short");
    }

    #[test]
    fn clamp_never_splits_a_multibyte_char() {
        // Remote output is routinely non-ASCII; byte slicing would panic here.
        let value = "中文输出内容";
        let clamped = clamp(value, 2);
        assert!(clamped.starts_with("中文"));
        assert!(clamped.contains("total 6 chars"));
    }

    #[test]
    fn seq_is_monotonic() {
        let a = next_seq();
        let b = next_seq();
        assert!(b > a);
    }

    #[test]
    fn entry_is_one_greppable_line() {
        let line = format_entry(
            RD_SCOPE,
            42,
            "12:34:56.789",
            "INFO",
            "be",
            "rd-host-1",
            "probe",
            "probe.output",
            "line1\nline2",
        );
        assert_eq!(
            line,
            "[rd-guide] #000042 12:34:56.789 INFO  src=be run=rd-host-1 phase=probe evt=probe.output | line1\\nline2"
        );
        // A multi-line detail must never become multiple physical lines, or
        // `grep`/`tail -f` on debug.log would split one event into fragments.
        assert!(!line.contains('\n'));
    }

    #[test]
    fn entry_falls_back_to_dash_for_missing_context() {
        let line = format_entry(RD_SCOPE, 0, "00:00:00.000", "WARN", "fe", "", "", "boot", "x");
        assert!(line.contains("run=- phase=- evt=boot"));
    }
}
