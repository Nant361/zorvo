//! The one place Zorvo starts processes.
//!
//! macOS gives a child the Screen Recording and Accessibility grants of the
//! app at the top of its launch chain. So that only the computer-use driver
//! uses Zorvo's grants, every other process is started through Zorvo's own
//! executable in its `disclaim-exec` mode, which gives up that responsibility
//! before it becomes the program (`trampoline`).
//!
//! The trampoline is set once at app start. Without it (unit tests, the CLI
//! modes, other platforms) programs start directly.

#[cfg(target_os = "macos")]
mod disclaim;
pub mod trampoline;

use std::ffi::OsStr;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

static TRAMPOLINE: OnceLock<PathBuf> = OnceLock::new();

/// The executable that runs `disclaim-exec`; later calls are ignored.
pub fn set_trampoline(path: PathBuf) {
    let _ = TRAMPOLINE.set(path);
}

fn trampoline() -> Option<&'static PathBuf> {
    if cfg!(target_os = "macos") {
        TRAMPOLINE.get()
    } else {
        None
    }
}

/// A command for `program` that does not inherit Zorvo's macOS grants. The
/// caller adds its own arguments.
#[allow(clippy::disallowed_methods)] // the one place allowed to build a Command
pub fn command(program: impl AsRef<OsStr>) -> Command {
    match trampoline() {
        Some(exe) => {
            let mut command = Command::new(exe);
            command.arg(trampoline::MODE).arg("--").arg(program);
            command
        }
        None => Command::new(program),
    }
}

/// The same for a program run in a pseudo-terminal.
#[allow(clippy::disallowed_methods)] // the one place allowed to build a CommandBuilder
pub fn pty_command(program: impl AsRef<OsStr>) -> portable_pty::CommandBuilder {
    match trampoline() {
        Some(exe) => {
            let mut command = portable_pty::CommandBuilder::new(exe);
            command.arg(trampoline::MODE);
            command.arg("--");
            command.arg(program);
            command
        }
        None => portable_pty::CommandBuilder::new(program),
    }
}

/// A command that keeps Zorvo's macOS grants. Only the computer-use driver
/// may be started this way: it is the process those grants are for.
#[allow(clippy::disallowed_methods)] // the driver is the one exception
pub fn driver_command(program: impl AsRef<OsStr>) -> Command {
    Command::new(program)
}

/// The pid macOS holds responsible for `pid`, or `None` when it cannot tell.
pub fn responsible_pid(pid: i32) -> Option<i32> {
    #[cfg(target_os = "macos")]
    {
        disclaim::responsible_pid(pid)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        None
    }
}
