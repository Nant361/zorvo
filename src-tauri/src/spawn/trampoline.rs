//! `zorvo disclaim-exec -- <program> <args…>`: become `program` with macOS
//! responsibility disclaimed. It only takes privileges away, so an agent may
//! run it too.

/// The first argument that selects this mode.
pub const MODE: &str = "disclaim-exec";

/// Exit status when the program cannot be started.
const CANNOT_START: i32 = 71;
/// Exit status when disclaiming is not possible on this system.
const NO_DISCLAIM: i32 = 70;
/// Exit status for a missing program.
const USAGE: i32 = 64;

/// Runs the mode with the arguments after `disclaim-exec`. Returns only when
/// the program could not be started.
pub fn run(args: &[String]) -> i32 {
    let args: &[String] = match args.first().map(String::as_str) {
        Some("--") => &args[1..],
        _ => args,
    };
    if args.is_empty() {
        eprintln!("zorvo {MODE}: no program to run");
        return USAGE;
    }
    exec(args)
}

#[cfg(target_os = "macos")]
fn exec(args: &[String]) -> i32 {
    use std::ffi::{c_char, CString};
    use std::os::unix::ffi::OsStrExt;

    let to_c = |text: &[u8]| CString::new(text).ok();
    let Some(argv_c) = args
        .iter()
        .map(|a| to_c(a.as_bytes()))
        .collect::<Option<Vec<_>>>()
    else {
        eprintln!("zorvo {MODE}: an argument holds a NUL byte");
        return USAGE;
    };
    let env_c: Vec<CString> = std::env::vars_os()
        .filter_map(|(key, value)| {
            let mut pair = key.as_bytes().to_vec();
            pair.push(b'=');
            pair.extend_from_slice(value.as_bytes());
            to_c(&pair)
        })
        .collect();
    let mut argv: Vec<*mut c_char> = argv_c.iter().map(|a| a.as_ptr().cast_mut()).collect();
    argv.push(std::ptr::null_mut());
    let mut envp: Vec<*mut c_char> = env_c.iter().map(|a| a.as_ptr().cast_mut()).collect();
    envp.push(std::ptr::null_mut());

    // SAFETY: the attributes are initialised before use and destroyed on every
    // path that returns; argv and envp are NUL-terminated arrays of valid C
    // strings that outlive the call. With POSIX_SPAWN_SETEXEC a success never
    // returns.
    unsafe {
        let mut attr: libc::posix_spawnattr_t = std::mem::zeroed();
        if libc::posix_spawnattr_init(&mut attr) != 0 {
            eprintln!("zorvo {MODE}: cannot prepare the spawn");
            return CANNOT_START;
        }
        if let Err(message) = super::disclaim::set_disclaim(&mut attr) {
            libc::posix_spawnattr_destroy(&mut attr);
            eprintln!("zorvo {MODE}: {message}");
            return NO_DISCLAIM;
        }
        libc::posix_spawnattr_setflags(&mut attr, libc::POSIX_SPAWN_SETEXEC as libc::c_short);
        let mut pid: libc::pid_t = 0;
        let code = libc::posix_spawnp(
            &mut pid,
            argv_c[0].as_ptr(),
            std::ptr::null(),
            &attr,
            argv.as_ptr(),
            envp.as_ptr(),
        );
        libc::posix_spawnattr_destroy(&mut attr);
        eprintln!(
            "zorvo {MODE}: cannot start {}: {}",
            args[0],
            std::io::Error::from_raw_os_error(code)
        );
        CANNOT_START
    }
}

#[cfg(not(target_os = "macos"))]
fn exec(args: &[String]) -> i32 {
    use std::os::unix::process::CommandExt;
    #[allow(clippy::disallowed_methods)] // nothing to disclaim off macOS
    let error = std::process::Command::new(&args[0]).args(&args[1..]).exec();
    eprintln!("zorvo {MODE}: cannot start {}: {error}", args[0]);
    CANNOT_START
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_an_empty_program_list() {
        assert_eq!(run(&[]), USAGE);
        assert_eq!(run(&["--".to_string()]), USAGE);
    }
}
