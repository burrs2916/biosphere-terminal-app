use std::path::Path;
use std::io::{self, Seek};

const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

pub fn init(log_dir: &Path) {
    let file_appender = match RollingFileAppender::new(log_dir, "biosphere.log") {
        Ok(fa) => fa,
        Err(e) => {
            eprintln!("Failed to open log file: {}. Logging to stderr only.", e);
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open("/dev/null")
                .expect("Cannot open /dev/null");
            RollingFileAppender {
                file: std::sync::Mutex::new(file),
                path: log_dir.join("biosphere.log"),
            }
        }
    };

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(file_appender)
        .with_target(true)
        .with_thread_ids(true)
        .with_line_number(true)
        .with_file(true)
        .init();

    tracing::info!("Logging initialized, log file: {:?}", log_dir.join("biosphere.log"));
    tracing::info!("Max log size: {} bytes", MAX_LOG_SIZE);
}

struct RollingFileAppender {
    file: std::sync::Mutex<std::fs::File>,
    path: std::path::PathBuf,
}

impl RollingFileAppender {
    fn new(directory: &Path, file_name: &str) -> io::Result<Self> {
        let path = directory.join(file_name);
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        Ok(RollingFileAppender {
            file: std::sync::Mutex::new(file),
            path,
        })
    }

    fn check_rotation(&self, file: &mut std::fs::File) {
        // Use the live file handle's metadata (avoid race with concurrent writers).
        let len = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => return,
        };
        if len < MAX_LOG_SIZE {
            return;
        }

        // Rotate: <name> -> <name>.1 (overwrite old backup), then truncate current.
        // We rename via filesystem to keep history. If rename fails (e.g. open
        // handle on Windows), fall back to truncating in-place.
        let backup = self.path.with_extension(
            self.path
                .extension()
                .map(|e| format!("{}.1", e.to_string_lossy()))
                .unwrap_or_else(|| "1".to_string()),
        );
        let _ = std::fs::remove_file(&backup);
        match std::fs::rename(&self.path, &backup) {
            Ok(()) => {
                // Reopen a fresh file at the original path and swap the handle.
                if let Ok(new_file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.path)
                {
                    *file = new_file;
                }
            }
            Err(_) => {
                // Fallback: truncate in place.
                let _ = file.set_len(0);
                let _ = file.rewind();
            }
        }
    }
}

impl io::Write for RollingFileAppender {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut file = self.file.lock().map_err(|e| io::Error::other(format!("log lock poisoned: {}", e)))?;
        self.check_rotation(&mut file);
        let result = file.write(buf);
        let _ = file.flush();
        let _ = io::stdout().write(buf);
        let _ = io::stdout().flush();
        result
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut file = self.file.lock().map_err(|e| io::Error::other(format!("log lock poisoned: {}", e)))?;
        file.flush()?;
        io::stdout().flush()
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for RollingFileAppender {
    type Writer = RollingFileAppenderGuard<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        let mut file = self.file.lock().map_err(|e| io::Error::other(format!("log lock poisoned: {}", e))).expect("log lock poisoned");
        self.check_rotation(&mut file);
        RollingFileAppenderGuard(file)
    }
}

struct RollingFileAppenderGuard<'a>(std::sync::MutexGuard<'a, std::fs::File>);

impl<'a> io::Write for RollingFileAppenderGuard<'a> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let result = self.0.write(buf);
        let _ = self.0.flush();
        let _ = io::stdout().write(buf);
        let _ = io::stdout().flush();
        result
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()?;
        io::stdout().flush()
    }
}
