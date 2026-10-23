//! Shared pty "expect" primitives for answering SSH authentication prompts.
//!
//! Three call sites drive an OpenSSH client over a pty and must recognise the
//! same interactive prompts:
//!
//! 1. `interface/commands/connection.rs::test_ssh_password` — the "test
//!    connection" button (password mode).
//! 2. `app/terminal_service.rs` — the interactive terminal's saved-password
//!    auto-fill.
//! 3. `app/sftp_service.rs` — the pooled SFTP session (Windows) and the
//!    ControlMaster feeder (macOS/Linux).
//!
//! They used to carry three matchers of very different maturity. The two
//! naive ones fed the *raw* pty byte stream into an `ends_with("password:")`
//! check — and on Windows the ConPTY layer (conhost) injects VT escape
//! sequences into that stream, so the buffer rarely ends with the bare prompt
//! and the password was never fed. The user-visible symptom was a false
//! "SSH 连接超时（主机不可达、网络不通，或认证长时间无响应）" from the test
//! button while every other SSH client connected fine. This module is the
//! single matcher all three now use.
//!
//! Locale note: OpenSSH localises its prompts to the client locale, so a
//! Chinese system shows "user@host 的密码：". Every ssh child we spawn sets
//! `LC_MESSAGES=C`, which pins the prompt to English "Password: ", but the
//! classifier still recognises the Chinese form as defence in depth.
//!
//! Nothing in here logs or returns the password: [`DiagBuf`] redacts it, so a
//! ConPTY echo of what we typed can never reach debug.log or a UI string.

use crate::core::platform::is_host_key_error;

/// An interactive prompt OpenSSH can block on before or during authentication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingPrompt {
    /// "user@host's password: " (or the localised "…的密码：").
    Password,
    /// "Enter passphrase for key '…':" — an encrypted private key.
    Passphrase,
    /// "Verification code: " / one-time password — server-side 2FA.
    Verification,
    /// "Are you sure you want to continue connecting (yes/no/[fingerprint])? "
    HostKey,
}

/// Recognise which prompt the *current partial line* (`pending`) holds.
///
/// Prompts never end with a newline, so a caller that flushes `pending` on
/// every line break always offers the live prompt here on its own. The
/// trailing-space variants matter: OpenSSH writes "password: " with a space.
pub fn classify_pending_prompt(pending: &str) -> Option<PendingPrompt> {
    let low = pending.trim_end().to_lowercase();
    if low.is_empty() {
        return None;
    }
    if low.ends_with("password:") || (low.contains("密码") && low.ends_with('：')) {
        return Some(PendingPrompt::Password);
    }
    if low.ends_with(':') && (low.contains("passphrase for key") || low.contains("enter passphrase")) {
        return Some(PendingPrompt::Passphrase);
    }
    if low.ends_with(':')
        && (low.contains("verification code")
            || low.contains("one-time password")
            || low.contains("otp:"))
    {
        return Some(PendingPrompt::Verification);
    }
    if low.ends_with('?') && (low.contains("(yes/no") || low.contains("fingerprint)")) {
        return Some(PendingPrompt::HostKey);
    }
    None
}

/// Strips VT/ANSI escape sequences from a pty byte stream.
///
/// Windows ConPTY (conhost) translates console writes into VT sequences, so
/// the raw stream contains CSI/OSC/charset-designator bytes that would
/// otherwise break any `ends_with` prompt match. The filter is a tiny state
/// machine whose state survives across `push` calls — a sequence may be split
/// between two reads.
#[derive(Default)]
pub struct AnsiFilter {
    state: u8,
}

impl AnsiFilter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append the filtered form of `input` to `out`.
    pub fn push(&mut self, input: &str, out: &mut String) {
        for c in input.chars() {
            match self.state {
                // normal
                0 => match c {
                    '\u{1b}' => self.state = 1,
                    '\u{7}' | '\u{0}' => {}
                    _ => out.push(c),
                },
                // ESC seen
                1 => match c {
                    '[' => self.state = 2,
                    ']' => self.state = 3,
                    '(' | ')' | '#' | '%' => self.state = 5,
                    _ => self.state = 0,
                },
                // CSI: consume until the final byte
                2 => {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        self.state = 0;
                    }
                }
                // OSC: terminated by BEL or ST (ESC \)
                3 => match c {
                    '\u{7}' => self.state = 0,
                    '\u{1b}' => self.state = 4,
                    _ => {}
                },
                4 => self.state = 0,
                // charset designator: swallow exactly one byte
                _ => self.state = 0,
            }
        }
    }
}

/// Rolling tail of the raw pty conversation, for diagnostics.
///
/// The buffer is capped and the secret (the password we type) is redacted on
/// the way in — ConPTY can echo our own writes back into the stream, and this
/// text ends up in debug.log and in user-facing error strings.
pub struct DiagBuf {
    buf: String,
    max: usize,
    secret: Option<String>,
}

impl DiagBuf {
    pub fn new(max: usize) -> Self {
        Self {
            buf: String::new(),
            max,
            secret: None,
        }
    }

    /// Register the secret to redact from every subsequent chunk.
    pub fn set_secret(&mut self, secret: &str) {
        if !secret.is_empty() {
            self.secret = Some(secret.to_string());
        }
    }

    pub fn push_str(&mut self, s: &str) {
        // `contains` first: the terminal hot path pushes every PTY chunk here,
        // and `str::replace` would allocate a fresh String each time.
        match &self.secret {
            Some(sec) if s.contains(sec.as_str()) => {
                self.buf.push_str(&s.replace(sec.as_str(), "***"));
            }
            _ => self.buf.push_str(s),
        }
        if self.buf.len() > self.max {
            let mut cut = self.buf.len() - self.max;
            while !self.buf.is_char_boundary(cut) {
                cut += 1;
            }
            self.buf.drain(..cut);
        }
    }

    /// Single-line snapshot, safe to log or embed in an error message.
    pub fn snapshot(&self) -> String {
        self.buf.replace(['\n', '\r'], " ")
    }
}

/// What the caller must do about the latest chunk of pty output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthAction {
    /// Nothing recognisable yet; keep reading.
    Idle,
    /// Write the password followed by Enter.
    FeedPassword,
    /// Answer the host-key confirmation with "yes".
    AnswerHostKeyYes,
    /// A prompt we cannot satisfy (2FA code, encrypted-key passphrase).
    /// Carries a ready-made, user-facing explanation.
    Unsatisfiable(&'static str),
}

/// Stateful expect loop over one pty conversation.
///
/// Feed every raw chunk to [`AuthResponder::push`] and perform the returned
/// action. The responder owns the ANSI filter, the current partial line (where
/// prompts live) and a redacted rolling transcript for diagnostics.
pub struct AuthResponder {
    ansi: AnsiFilter,
    /// Current partial line, ANSI-filtered. Cleared on every line break.
    pending: String,
    diag: DiagBuf,
    /// Rolling filtered window scanned for host-key verification failures.
    hostkey_buf: String,
    password: Option<String>,
    password_fed: bool,
    /// Set the moment a password prompt is seen, even when no password is
    /// available to feed — callers use it to report "needs a password".
    password_prompt_seen: bool,
    host_key_answered: bool,
}

/// Bound for `pending`: prompts are short; a progress-bar line without a
/// newline must not grow it without limit.
const PENDING_MAX: usize = 256;

/// Rolling window used to spot "REMOTE HOST IDENTIFICATION HAS CHANGED".
const HOSTKEY_WINDOW: usize = 1024;

impl AuthResponder {
    pub fn new(password: Option<String>) -> Self {
        let mut diag = DiagBuf::new(2048);
        if let Some(pw) = &password {
            diag.set_secret(pw);
        }
        Self {
            ansi: AnsiFilter::new(),
            pending: String::with_capacity(PENDING_MAX),
            diag,
            hostkey_buf: String::with_capacity(HOSTKEY_WINDOW),
            password,
            password_fed: false,
            password_prompt_seen: false,
            host_key_answered: false,
        }
    }

    /// Feed one raw chunk; returns the action the caller must perform.
    pub fn push(&mut self, chunk: &str) -> AuthAction {
        self.diag.push_str(chunk);

        let mut filtered = String::with_capacity(chunk.len());
        self.ansi.push(chunk, &mut filtered);

        // Host-key-change detection rides on the filtered stream (the error
        // text is plain ASCII) so callers can ask after the loop.
        self.hostkey_buf.push_str(&filtered);
        if self.hostkey_buf.len() > HOSTKEY_WINDOW {
            let mut cut = self.hostkey_buf.len() - HOSTKEY_WINDOW;
            while !self.hostkey_buf.is_char_boundary(cut) {
                cut += 1;
            }
            self.hostkey_buf.drain(..cut);
        }

        for ch in filtered.chars() {
            if ch == '\n' || ch == '\r' {
                self.pending.clear();
            } else {
                self.pending.push(ch);
                if self.pending.len() > PENDING_MAX {
                    let mut cut = self.pending.len() - PENDING_MAX;
                    while !self.pending.is_char_boundary(cut) {
                        cut += 1;
                    }
                    self.pending.drain(..cut);
                }
            }
        }

        if self.password_fed {
            // ssh may re-prompt (wrong password); we answer exactly once and
            // let the exit code tell the story.
            return AuthAction::Idle;
        }

        match classify_pending_prompt(&self.pending) {
            Some(PendingPrompt::Password) => {
                self.password_prompt_seen = true;
                if self.password.is_some() {
                    self.password_fed = true;
                    self.pending.clear();
                    AuthAction::FeedPassword
                } else {
                    // Seen, but nothing to feed — the caller reports it.
                    AuthAction::Idle
                }
            }
            Some(PendingPrompt::HostKey) => {
                self.host_key_answered = true;
                self.pending.clear();
                AuthAction::AnswerHostKeyYes
            }
            Some(PendingPrompt::Passphrase) => {
                AuthAction::Unsatisfiable(
                    "私钥已加密，需要口令（请改用未加密的密钥或先 ssh-add 到代理）",
                )
            }
            Some(PendingPrompt::Verification) => {
                AuthAction::Unsatisfiable("服务器要求二次验证码，暂不支持该登录方式")
            }
            _ => AuthAction::Idle,
        }
    }

    /// True once the transcript shows a host-key verification failure.
    pub fn host_key_changed(&self) -> bool {
        is_host_key_error(&self.hostkey_buf)
    }

    /// Redacted single-line transcript, for debug.log / error messages.
    pub fn diag(&self) -> String {
        self.diag.snapshot()
    }

    pub fn password_fed(&self) -> bool {
        self.password_fed
    }

    /// True once a password prompt has been observed, fed or not.
    pub fn password_prompt_seen(&self) -> bool {
        self.password_prompt_seen
    }

    pub fn host_key_answered(&self) -> bool {
        self.host_key_answered
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(r: &mut AuthResponder, chunks: &[&str]) -> Vec<AuthAction> {
        chunks.iter().map(|c| r.push(c)).collect()
    }

    #[test]
    fn ansi_filter_strips_csi_and_osc_sequences() {
        let mut f = AnsiFilter::new();
        let mut out = String::new();
        // CSI colour, CSI reset, then an OSC window-title (swallowed whole,
        // BEL-terminated) — nothing but the prompt text may survive.
        f.push("\x1b[32mdfy@host's password: \x1b[0m\x1b]0;title\x07", &mut out);
        assert_eq!(out, "dfy@host's password: ");
    }

    /// The Windows regression: conhost appends a cursor-visibility sequence
    /// after the prompt, so the raw buffer does NOT end with "password: ".
    /// Only the filtered stream does.
    #[test]
    fn password_prompt_with_trailing_conpty_sequence_is_matched() {
        let mut r = AuthResponder::new(Some("s3cret".into()));
        let action = r.push("dfy@192.168.56.101's password: \x1b[?25h");
        assert_eq!(action, AuthAction::FeedPassword);
        assert!(r.password_fed());
    }

    #[test]
    fn prompt_split_across_chunks_is_matched() {
        let mut r = AuthResponder::new(Some("pw".into()));
        assert_eq!(r.push("dfy@host's pass"), AuthAction::Idle);
        assert_eq!(r.push("word: "), AuthAction::FeedPassword);
    }

    #[test]
    fn chinese_password_prompt_is_matched() {
        let mut r = AuthResponder::new(Some("pw".into()));
        assert_eq!(r.push("dfy@192.168.56.101 的密码："), AuthAction::FeedPassword);
    }

    #[test]
    fn host_key_confirmation_is_answered_with_yes() {
        let mut r = AuthResponder::new(Some("pw".into()));
        let action = r.push(
            "The authenticity of host '10.0.0.2' can't be established.\n\
             Are you sure you want to continue connecting (yes/no/[fingerprint])? ",
        );
        assert_eq!(action, AuthAction::AnswerHostKeyYes);
        assert!(r.host_key_answered());
    }

    #[test]
    fn first_connect_sequence_answers_yes_then_feeds_password() {
        let mut r = AuthResponder::new(Some("pw".into()));
        let actions = feed_all(
            &mut r,
            &[
                "The authenticity of host '10.0.0.2' can't be established.\n",
                "Are you sure you want to continue connecting (yes/no/[fingerprint])? ",
                "Warning: Permanently added '10.0.0.2' (ECDSA) to the list of known hosts.\n",
                "dfy@10.0.0.2's password: ",
            ],
        );
        assert_eq!(
            actions,
            vec![
                AuthAction::Idle,
                AuthAction::AnswerHostKeyYes,
                AuthAction::Idle,
                AuthAction::FeedPassword,
            ]
        );
    }

    #[test]
    fn verification_code_is_unsatisfiable_not_a_timeout() {
        let mut r = AuthResponder::new(Some("pw".into()));
        let action = r.push("Verification code: ");
        assert!(matches!(action, AuthAction::Unsatisfiable(_)));
        assert!(!r.password_fed());
    }

    #[test]
    fn password_prompt_without_a_password_is_reported_not_fed() {
        let mut r = AuthResponder::new(None);
        assert_eq!(r.push("dfy@host's password: "), AuthAction::Idle);
        assert!(r.password_prompt_seen());
        assert!(!r.password_fed());
    }

    #[test]
    fn encrypted_key_passphrase_is_unsatisfiable() {
        let mut r = AuthResponder::new(Some("pw".into()));
        let action = r.push("Enter passphrase for key 'C:\\Users\\a\\.ssh\\id_rsa': ");
        assert!(matches!(action, AuthAction::Unsatisfiable(_)));
    }

    /// ssh re-prompts up to 3 times on a wrong password; we must answer once
    /// and let the non-zero exit code produce "auth failed", not a timeout.
    #[test]
    fn password_is_fed_exactly_once() {
        let mut r = AuthResponder::new(Some("pw".into()));
        assert_eq!(r.push("dfy@host's password: "), AuthAction::FeedPassword);
        assert_eq!(r.push("dfy@host's password: "), AuthAction::Idle);
        assert_eq!(r.push("dfy@host's password: "), AuthAction::Idle);
    }

    /// ConPTY echoes our own write back into the stream; the transcript must
    /// never contain the password.
    #[test]
    fn diag_redacts_the_password_echo() {
        let mut r = AuthResponder::new(Some("hunter2".into()));
        assert_eq!(r.push("dfy@host's password: "), AuthAction::FeedPassword);
        r.push("hunter2\r\n");
        r.push("Permission denied, please try again.\r\n");
        let diag = r.diag();
        assert!(!diag.contains("hunter2"), "diag leaked the password: {diag}");
        assert!(diag.contains("***"));
        assert!(diag.contains("Permission denied"));
    }

    #[test]
    fn host_key_change_is_detected_on_the_filtered_stream() {
        let mut r = AuthResponder::new(Some("pw".into()));
        r.push("\x1b[1m@@@@ REMOTE HOST IDENTIFICATION HAS CHANGED! @@@@\x1b[0m\n");
        assert!(r.host_key_changed());
    }

    #[test]
    fn motd_noise_does_not_look_like_a_prompt() {
        let mut r = AuthResponder::new(Some("pw".into()));
        let actions = feed_all(
            &mut r,
            &[
                "Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-31-generic x86_64)\n",
                " * Documentation:  https://help.ubuntu.com\n",
                "Last login: Tue Oct 20 18:56:01 2026 from 10.0.0.5\n",
            ],
        );
        assert!(actions.iter().all(|a| *a == AuthAction::Idle));
        assert!(!r.password_fed());
    }

    /// Guardrail: every pty-expect call site must go through this module.
    /// A regression to a private, ANSI-naive matcher is exactly the bug that
    /// produced the false "连接超时" on Windows.
    ///
    /// SFTP is now a native russh channel (`sftp_native`), with no pty in the
    /// path, so it is no longer a pty-expect call site and is excluded on
    /// purpose. The SSH *test connection* path (`commands/connection.rs`) was
    /// likewise migrated to protocol-level auth via `ssh_common::establish` —
    /// no pty, no prompt scraping — so it is no longer a call site either. The
    /// only remaining consumer is the ConPTY local-shell fallback in
    /// `terminal_service.rs`, which still feeds a real ssh.exe's password prompt.
    #[test]
    fn all_call_sites_use_the_shared_module() {
        let call_sites = [include_str!("../../app/terminal_service.rs")];
        for src in call_sites {
            assert!(
                src.contains("pty_expect::"),
                "a pty-expect call site stopped using the shared matcher"
            );
        }
        let pty = include_str!("pty.rs");
        assert!(
            !pty.contains("pub fn is_password_prompt"),
            "the old ANSI-naive matcher is back in pty.rs"
        );
    }
}
