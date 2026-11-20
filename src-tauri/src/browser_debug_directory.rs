//! Parent-owned private worker directories. Advisory leases survive worker SIGKILL.
use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

const PREFIX: &str = "zorvo-browser-debug-";
const LEASE: &str = ".owner.lock";

fn owned_directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| {
        // SAFETY: geteuid has no pointer arguments and only reads process identity.
        meta.is_dir() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0
    })
}

fn named_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.strip_prefix(PREFIX).is_some_and(|suffix| {
                suffix.len() == 32 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        })
}

fn lock(file: &File, nonblocking: bool) -> bool {
    // SAFETY: the live file descriptor belongs to this open File. flock does not
    // follow any path; O_NOFOLLOW was applied when opening the lease below.
    unsafe {
        libc::flock(
            file.as_raw_fd(),
            libc::LOCK_EX | if nonblocking { libc::LOCK_NB } else { 0 },
        ) == 0
    }
}

fn open_lock(path: &Path, create: bool) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
        .map_err(|error| error.to_string())?;
    let meta = file.metadata().map_err(|error| error.to_string())?;
    if !meta.is_file()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o077 != 0
        || meta.nlink() != 1
    {
        return Err("The browser cleanup lease is not a private owned file.".into());
    }
    Ok(file)
}

fn parent_lock(parent: &Path) -> Result<File, String> {
    match fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
    {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.to_string()),
    }
    let meta = fs::symlink_metadata(parent).map_err(|error| error.to_string())?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
        return Err("The browser data folder is not an owned directory.".into());
    }
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    let lease = open_lock(&parent.join(".workers.lock"), true)?;
    if !lock(&lease, false) {
        return Err("The browser cleanup lock is unavailable.".into());
    }
    Ok(lease)
}

fn sweep_locked(parent: &Path) -> usize {
    let Ok(entries) = fs::read_dir(parent) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            let path = entry.path();
            if !named_directory(&path) || !owned_directory(&path) {
                return false;
            }
            let lease_path = path.join(LEASE);
            let lease = match open_lock(&lease_path, false) {
                Ok(lease) => Some(lease),
                // A crash between mkdir and the lease creation is stale too. Creation
                // and sweeping hold the parent lock, so a live creator cannot be here.
                Err(_)
                    if fs::symlink_metadata(&lease_path)
                        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
                {
                    None
                }
                Err(_) => return false,
            };
            if lease.as_ref().is_some_and(|lease| !lock(lease, true)) {
                return false;
            }
            // remove_dir_all never follows symlinks within the tree. Recheck the root
            // after opening its lease; a replaced root must not broaden cleanup.
            owned_directory(&path) && fs::remove_dir_all(path).is_ok()
        })
        .count()
}

pub(super) fn sweep(parent: &Path) -> Result<usize, String> {
    let _parent = parent_lock(parent)?;
    Ok(sweep_locked(parent))
}

pub(super) struct Directory {
    path: PathBuf,
    _lease: File,
}

impl Directory {
    pub(super) fn create(parent: &Path) -> Result<Self, String> {
        let _parent = parent_lock(parent)?;
        sweep_locked(parent);
        let parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|_| "Could not name the browser worker folder.")?;
        let name: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = parent.join(format!("{PREFIX}{name}"));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|error| error.to_string())?;
        let result = (|| {
            let lease = open_lock(&path.join(LEASE), true)?;
            if !lock(&lease, true) {
                return Err("The browser worker lease is unavailable.".into());
            }
            Ok(Self {
                path: path.clone(),
                _lease: lease,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&path);
        }
        result
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn remove(&self) {
        if named_directory(&self.path) && owned_directory(&self.path) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        self.remove();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;
    use std::os::unix::fs::symlink;

    #[test]
    fn sweep_removes_stale_owned_folders_and_preserves_live_leases_and_symlinks() {
        let temp = Temp::new("browser-worker-sweep");
        let parent = temp.0.join("browser-debug");
        let active = Directory::create(&parent).unwrap();
        fs::write(active.path().join("active-profile"), "keep").unwrap();
        let stale_path = parent.join(format!("{PREFIX}{}", "a".repeat(32)));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&stale_path)
            .unwrap();
        fs::write(stale_path.join("upload-copy"), "private").unwrap();
        // An app crash leaves the directory but releases its file lease.
        let stale_lease = open_lock(&stale_path.join(LEASE), true).unwrap();
        assert!(lock(&stale_lease, true));
        drop(stale_lease);
        let external = temp.0.join("external");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("keep"), "outside").unwrap();
        symlink(
            &external,
            parent.join(format!("{PREFIX}{}", "f".repeat(32))),
        )
        .unwrap();
        fs::create_dir(parent.join("unrelated")).unwrap();
        assert_eq!(sweep(&parent).unwrap(), 1);
        assert!(!stale_path.exists());
        assert!(active.path().join("active-profile").exists());
        assert!(external.join("keep").exists());
        assert!(parent.join("unrelated").exists());
    }

    #[test]
    fn sweep_refuses_a_symlinked_data_folder() {
        let temp = Temp::new("browser-worker-parent");
        let outside = temp.0.join("outside");
        fs::create_dir(&outside).unwrap();
        let linked = temp.0.join("linked");
        symlink(&outside, &linked).unwrap();
        assert!(Directory::create(&linked).is_err());
        assert!(sweep(&linked).is_err());
    }
}
