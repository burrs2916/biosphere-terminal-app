//! known_hosts maintenance for the native SFTP lane.
//!
//! `russh` already *checks* recorded keys (`check_known_hosts`) and *learns*
//! new ones (`learn_known_hosts`), but it never forgets. The old subprocess
//! lane delegated that to `ssh-keygen -R`; the native lane cannot (no
//! external binaries by design), so removal lives here.
//!
//! Matching mirrors the check side: a line belongs to this host when any of
//! its comma-separated patterns is the plain hostname, the `[host]:port` form
//! for non-default ports, or a hashed `|1|salt|hash` entry whose HMAC-SHA1
//! matches. Wildcard patterns are deliberately not matched — `russh`'s checker
//! does not match them either, so leaving them alone keeps check and removal
//! consistent (a stale wildcard line simply never matches anything).

use std::io::Write;
use std::path::PathBuf;

use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use sha1::Sha1;

/// Hostname as OpenSSH writes it in known_hosts: bare for port 22,
/// bracketed with the port otherwise.
fn hostname_for(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

fn home_ssh_dir() -> Option<PathBuf> {
    std::env::home_dir().map(|h| h.join(".ssh"))
}

fn known_hosts_path() -> Option<PathBuf> {
    home_ssh_dir().map(|d| d.join("known_hosts"))
}

/// Does one comma-separated pattern group from a known_hosts line refer to
/// this host:port?
fn patterns_match(patterns: &str, host: &str, port: u16) -> bool {
    let want = hostname_for(host, port);
    patterns.split(',').any(|p| {
        let p = p.trim();
        if let Some(rest) = p.strip_prefix("|1|") {
            // Hashed: |1|<b64 salt>|<b64 hmac-sha1(salt, hostname)>
            let mut parts = rest.split('|');
            let (Some(salt_b64), Some(hash_b64), None) =
                (parts.next(), parts.next(), parts.next())
            else {
                return false;
            };
            let Ok(salt) = base64::engine::general_purpose::STANDARD.decode(salt_b64) else {
                return false;
            };
            let Ok(hash) = base64::engine::general_purpose::STANDARD.decode(hash_b64) else {
                return false;
            };
            let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else {
                return false;
            };
            mac.update(want.as_bytes());
            mac.verify_slice(&hash).is_ok()
        } else {
            p == want
        }
    })
}

/// True when a known_hosts line's first field refers to this host:port.
fn line_matches(line: &str, host: &str, port: u16) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return false;
    }
    // Markers (@revoked / @cert-authority) prefix the host field; the host
    // field is whatever comes after them.
    let field = trimmed
        .split_whitespace()
        .find(|t| !t.starts_with('@'))
        .unwrap_or("");
    !field.is_empty() && patterns_match(field, host, port)
}

/// Drop every known_hosts entry that refers to `host:port`.
///
/// Used after a host-key change: the stale record is what makes the next
/// handshake refuse the (legitimate) new key. Missing files are fine — there
/// is nothing to forget.
pub fn remove_entries(host: &str, port: u16) {
    let Some(path) = known_hosts_path() else {
        tracing::warn!("[SFTP] no home directory; cannot clear known_hosts for {}", host);
        return;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return; // no recorded keys yet
    };
    let kept: Vec<&str> = content
        .lines()
        .filter(|l| !line_matches(l, host, port))
        .collect();
    if kept.len() == content.lines().count() {
        return; // nothing referred to this host
    }
    let mut out = kept.join("\n");
    out.push('\n');
    // Write beside the original and rename over it: a crash mid-write can
    // never leave a truncated trust store.
    let tmp = path.with_extension("known_hosts.tmp");
    match std::fs::File::create(&tmp).and_then(|mut f| f.write_all(out.as_bytes())) {
        Ok(()) => {
            if let Err(e) = std::fs::rename(&tmp, &path) {
                tracing::warn!("[SFTP] known_hosts rename failed: {}", e);
                let _ = std::fs::remove_file(&tmp);
            } else {
                tracing::info!(
                    "[SFTP] cleared stale known_hosts entries for {}:{}",
                    host,
                    port
                );
            }
        }
        Err(e) => {
            tracing::warn!("[SFTP] known_hosts rewrite failed: {}", e);
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hmac_b64(salt: &[u8], hostname: &str) -> String {
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).unwrap();
        mac.update(hostname.as_bytes());
        base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
    }

    #[test]
    fn hostname_form_follows_the_port() {
        assert_eq!(hostname_for("example.com", 22), "example.com");
        assert_eq!(hostname_for("example.com", 2222), "[example.com]:2222");
    }

    #[test]
    fn plain_and_port_forms_match() {
        assert!(patterns_match("example.com", "example.com", 22));
        assert!(!patterns_match("example.com", "example.com", 2222));
        assert!(patterns_match("[example.com]:2222", "example.com", 2222));
        assert!(patterns_match(
            "a.example.com,example.com,b.example.com",
            "example.com",
            22
        ));
        assert!(!patterns_match("other.com", "example.com", 22));
    }

    #[test]
    fn hashed_entries_match_by_hmac() {
        let salt = b"0123456789abcdef";
        let hash = hmac_b64(salt, "secret.example.com");
        let pattern = format!(
            "|1|{}|{}",
            base64::engine::general_purpose::STANDARD.encode(salt),
            hash
        );
        assert!(patterns_match(&pattern, "secret.example.com", 22));
        assert!(!patterns_match(&pattern, "other.example.com", 22));
        // Non-default ports hash the bracketed form.
        let hash_p = hmac_b64(salt, "[secret.example.com]:2222");
        let pattern_p = format!(
            "|1|{}|{}",
            base64::engine::general_purpose::STANDARD.encode(salt),
            hash_p
        );
        assert!(patterns_match(&pattern_p, "secret.example.com", 2222));
        assert!(!patterns_match(&pattern_p, "secret.example.com", 22));
    }

    #[test]
    fn line_matching_ignores_comments_and_markers() {
        assert!(line_matches(
            "#example.com ssh-ed25519 AAAA",
            "example.com",
            22
        ) == false);
        assert!(line_matches(
            "@cert-authority example.com ssh-ed25519 AAAA",
            "example.com",
            22
        ));
        assert!(line_matches(
            "example.com ssh-ed25519 AAAA",
            "example.com",
            22
        ));
        assert!(!line_matches("", "example.com", 22));
    }

    #[test]
    fn removal_keeps_unrelated_lines() {
        // Exercise the filter logic directly (no home dir mutation in tests).
        let content = "\
# a comment
keep.me ssh-ed25519 AAAAkeep
gone.com ssh-ed25519 AAAAgone
[gone.com]:2222 ssh-ed25519 AAAAgoneport
multi.com,gone.com ssh-ed25519 AAAAmulti
";
        let kept: Vec<&str> = content
            .lines()
            .filter(|l| !line_matches(l, "gone.com", 22))
            .collect();
        assert_eq!(kept.len(), 3);
        assert!(kept.iter().any(|l| l.starts_with("keep.me")));
        assert!(kept.iter().any(|l| l.starts_with("# a comment")));
        // The port-form and the multi-name entry only go for the right port.
        let kept_port: Vec<&str> = content
            .lines()
            .filter(|l| !line_matches(l, "gone.com", 2222))
            .collect();
        assert_eq!(kept_port.len(), 4);
        assert!(!kept_port.iter().any(|l| l.starts_with("[gone.com]:2222")));
        assert!(kept_port.iter().any(|l| l.starts_with("gone.com ")));
    }
}
