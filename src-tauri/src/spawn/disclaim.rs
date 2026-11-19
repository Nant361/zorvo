//! The private libSystem calls behind disclaiming. They are not public API,
//! so they are looked up at run time; a missing one is reported, never
//! papered over.

use std::ffi::{c_int, c_void, CString};

type SetDisclaim = unsafe extern "C" fn(*mut libc::posix_spawnattr_t, c_int) -> c_int;
type ResponsibleFor = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

fn symbol(name: &str) -> Option<*mut c_void> {
    let name = CString::new(name).ok()?;
    // SAFETY: dlsym with RTLD_DEFAULT and a NUL-terminated name only reads.
    let found = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    (!found.is_null()).then_some(found)
}

/// Marks `attr` so the spawned process is its own responsible process.
/// `Err` when the symbol is missing or the call fails.
pub(crate) fn set_disclaim(attr: &mut libc::posix_spawnattr_t) -> Result<(), String> {
    let found = symbol("responsibility_spawnattrs_setdisclaim")
        .ok_or("responsibility_spawnattrs_setdisclaim is not available")?;
    // SAFETY: the symbol has this signature in libSystem since macOS 10.14.
    let set: SetDisclaim = unsafe { std::mem::transmute(found) };
    // SAFETY: `attr` was initialised by the caller.
    match unsafe { set(attr, 1) } {
        0 => Ok(()),
        code => Err(format!(
            "responsibility_spawnattrs_setdisclaim failed: {code}"
        )),
    }
}

pub(crate) fn responsible_pid(pid: i32) -> Option<i32> {
    let found = symbol("responsibility_get_pid_responsible_for_pid")?;
    // SAFETY: the symbol has this signature in libSystem.
    let get: ResponsibleFor = unsafe { std::mem::transmute(found) };
    // SAFETY: plain call with a pid; returns -1 for an unknown pid.
    let responsible = unsafe { get(pid) };
    (responsible > 0).then_some(responsible)
}
