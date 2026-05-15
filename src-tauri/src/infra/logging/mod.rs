use std::path::Path;

const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

pub fn init(log_dir: &Path) {
    let log_file = log_dir.join("biosphere.log");

    let file_appender = tracing_appender::never(
        log_dir,
        "biosphere.log",
    );

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

mod tracing_appender {
    use std::fs::{self, File, OpenOptions};
    use std::io::{self, Seek};
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

    pub struct RollingFileAppender {
        file: Mutex<File>,
        path: PathBuf,
    }

    impl io::Write for RollingFileAppender {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.file.get_mut().unwrap().write(buf)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.file.get_mut().unwrap().flush()
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for RollingFileAppender {
        type Writer = MutexGuardWriter<'a>;

        fn make_writer(&'a self) -> Self::Writer {
            let mut file = self.file.lock().expect("log lock poisoned");
            self.check_rotation(&mut file);
            MutexGuardWriter(file)
        }
    }

    impl RollingFileAppender {
        fn check_rotation(&self, file: &mut File) {
            if let Ok(metadata) = fs::metadata(&self.path) {
                if metadata.len() >= MAX_LOG_SIZE {
                    let _ = file.set_len(0);
                    let _ = file.rewind();
                }
            }
        }
    }

    pub struct MutexGuardWriter<'a>(std::sync::MutexGuard<'a, File>);

    impl<'a> io::Write for MutexGuardWriter<'a> {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.write(buf)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.0.flush()
        }
    }

    pub fn never(directory: &Path, file_name: &str) -> RollingFileAppender {
        let path = directory.join(file_name);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .expect("failed to open log file");
        RollingFileAppender {
            file: Mutex::new(file),
            path,
        }
    }
}
