//! Which process is on the other end of a connection, and whether it belongs
//! to a session's agent.
//!
//! A token alone can be read from another process's environment (`ps -E`)
//! by any process of the same user, so a connection must also come from the
//! agent process the token was issued to, or from one of its descendants (its
//! `zorvo mcp-bridge`, or `zorvo tools` run from its shell). A process is named
//! by its pid and start time, so a pid reused by a newer process never
//! matches.

use std::os::unix::net::UnixStream;

/// The longest parent chain walked before giving up.
const MAX_STEPS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ProcessId {
    pub pid: i32,
    /// Microseconds since the epoch at which the process started.
    pub started_us: u64,
}

/// Parent lookups; the system's in production, a table in tests.
pub trait ProcessTable {
    /// `process`'s parent, or `None` when `process` is gone (or its pid now
    /// names a newer process) or has no parent.
    fn parent(&self, process: ProcessId) -> Option<ProcessId>;
}

/// Whether `child` is `ancestor` or descends from it, comparing pid and start
/// time at every step.
pub fn descends_from(table: &impl ProcessTable, child: ProcessId, ancestor: ProcessId) -> bool {
    let mut current = child;
    for _ in 0..MAX_STEPS {
        if current == ancestor {
            return true;
        }
        match table.parent(current) {
            Some(parent) if parent.pid > 0 => current = parent,
            _ => return false,
        }
    }
    false
}

/// The processes of this Mac, read with `sysctl`.
pub struct SystemProcessTable;

impl ProcessTable for SystemProcessTable {
    fn parent(&self, process: ProcessId) -> Option<ProcessId> {
        let (started_us, parent_pid) = system::start_and_parent(process.pid)?;
        if started_us != process.started_us {
            return None;
        }
        ProcessId::of(parent_pid)
    }
}

impl ProcessId {
    /// The live process with this pid, named with its start time.
    pub fn of(pid: i32) -> Option<ProcessId> {
        let (started_us, _) = system::start_and_parent(pid)?;
        Some(ProcessId { pid, started_us })
    }
}

/// The process on the other end of `stream`.
pub fn peer_process(stream: &UnixStream) -> Option<ProcessId> {
    ProcessId::of(system::peer_pid(stream)?)
}

#[cfg(target_os = "macos")]
mod system {
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;

    /// `SOL_LOCAL` and `LOCAL_PEERPID` from `<sys/un.h>`.
    const SOL_LOCAL: libc::c_int = 0;
    const LOCAL_PEERPID: libc::c_int = 2;

    pub(super) fn peer_pid(stream: &UnixStream) -> Option<i32> {
        let mut pid: libc::pid_t = 0;
        let mut length = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
        // SAFETY: getsockopt writes at most `length` bytes into `pid`.
        let code = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                SOL_LOCAL,
                LOCAL_PEERPID,
                (&mut pid as *mut libc::pid_t).cast(),
                &mut length,
            )
        };
        (code == 0 && pid > 0).then_some(pid)
    }

    pub(super) fn start_and_parent(pid: i32) -> Option<(u64, i32)> {
        if pid <= 0 {
            return None;
        }
        // SAFETY: an all-zero proc_bsdinfo is a valid value to be overwritten.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: proc_pidinfo writes at most `size` bytes into `info`.
        let written = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if written != size || info.pbi_pid as i32 != pid {
            return None;
        }
        let started_us = info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec;
        Some((started_us, info.pbi_ppid as i32))
    }
}

#[cfg(not(target_os = "macos"))]
mod system {
    use std::os::unix::net::UnixStream;

    pub(super) fn peer_pid(_stream: &UnixStream) -> Option<i32> {
        None
    }

    pub(super) fn start_and_parent(_pid: i32) -> Option<(u64, i32)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Table(HashMap<ProcessId, ProcessId>);

    impl ProcessTable for Table {
        fn parent(&self, process: ProcessId) -> Option<ProcessId> {
            self.0.get(&process).copied()
        }
    }

    fn id(pid: i32, started_us: u64) -> ProcessId {
        ProcessId { pid, started_us }
    }

    #[test]
    fn descends_through_parents() {
        let agent = id(10, 1);
        let shell = id(11, 2);
        let tools = id(12, 3);
        let table = Table(HashMap::from([(tools, shell), (shell, agent)]));
        assert!(descends_from(&table, tools, agent));
        assert!(descends_from(&table, agent, agent));
        assert!(!descends_from(&table, agent, tools));
    }

    #[test]
    fn stops_at_a_reused_pid() {
        let agent = id(10, 1);
        // Same pid as the agent, but a newer process.
        let impostor_parent = id(10, 99);
        let child = id(12, 3);
        let table = Table(HashMap::from([(child, impostor_parent)]));
        assert!(!descends_from(&table, child, agent));
    }

    #[test]
    fn gives_up_after_64_steps() {
        let agent = id(1_000, 1);
        let mut chain = HashMap::new();
        for pid in 1..=100 {
            chain.insert(id(pid, pid as u64), id(pid + 1, (pid + 1) as u64));
        }
        chain.insert(id(101, 101), agent);
        assert!(!descends_from(&Table(chain), id(1, 1), agent));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_process_descends_from_itself_and_its_parent() {
        let me = ProcessId::of(std::process::id() as i32).expect("this process");
        assert!(descends_from(&SystemProcessTable, me, me));
        let parent = SystemProcessTable.parent(me).expect("a parent");
        assert!(descends_from(&SystemProcessTable, me, parent));
        let older = ProcessId {
            started_us: me.started_us + 1,
            ..me
        };
        assert!(!descends_from(&SystemProcessTable, me, older));
    }
}
