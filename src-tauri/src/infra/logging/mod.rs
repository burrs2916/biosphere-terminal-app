use std::path::Path;
use std::io::{self, Seek, Write};

const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

pub fn init(log_dir: &Path) {
    let log_file = log_dir.join("biosphere.log");

    let file_appender = RollingFileAppender::new(log_dir, "biosphere.log");

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

    tracing::info!("Logging initialized, log file: {:?}", log_file);
    tracing::info!("Max log size: {} bytes", MAX_LOG_SIZE);
}

struct RollingFileAppender {
    file: std::sync::Mutex<std::fs::File>,
    path: std::path::PathBuf,
}

impl RollingFileAppender {
    fn new(directory: &Path, file_name: &str) -> Self {
        let path = directory.join(file_name);
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .expect("failed to open log file");
        RollingFileAppender {
            file: std::sync::Mutex::new(file),
            path,
        }
    }

    fn check_rotation(&self, file: &mut std::fs::File) {
        if let Ok(metadata) = std::fs::metadata(&self.path) {
            if metadata.len() >= MAX_LOG_SIZE {
                let _ = file.set_len(0);
                let _ = file.rewind();
            }
        }
    }
}

impl io::Write for RollingFileAppender {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut file = self.file.lock().expect("log lock poisoned");
        self.check_rotation(&mut file);
        let result = file.write(buf);
        let _ = file.flush();
        let _ = io::stdout().write(buf);
        let _ = io::stdout().flush();
        result
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut file = self.file.lock().expect("log lock poisoned");
        file.flush()?;
        io::stdout().flush()
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for RollingFileAppender {
    type Writer = RollingFileAppenderGuard<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        let mut file = self.file.lock().expect("log lock poisoned");
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
