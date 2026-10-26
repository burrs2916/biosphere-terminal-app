fn main() {
    // Stamp the current git commit into the binary so every startup log can
    // prove exactly which build is running ("build=<sha>" line in the banner).
    // CI builds always have .git; a source snapshot without git falls back to
    // "dev" instead of failing the build.
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=GIT_COMMIT_SHA={sha}");
    println!("cargo:rerun-if-changed=.git/HEAD");
    tauri_build::build()
}
