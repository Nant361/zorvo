//! Pages an agent makes and Zorvo shows: versioned copies kept per session.
//! Design: `docs/superpowers/specs/2026-11-16-artifacts-design.md`.

pub mod protocol;
pub mod source;
pub mod store;
pub mod view;

#[cfg(test)]
pub(crate) mod test_support {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A temp folder removed when the test ends, even on panic.
    pub struct Temp(pub PathBuf);

    impl Temp {
        pub fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zorvo-artifacts-{tag}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp folder");
            Self(fs::canonicalize(path).expect("canonical temp folder"))
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
