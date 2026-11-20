//! A session-owned JSONL worker. Regular Chromium uses a CDP pipe; optional
//! Lighthouse audits temporarily open a loopback-only DevTools port.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[path = "browser_debug_directory.rs"]
mod directory;

#[derive(Default)]
pub struct DebugBrowsers(Mutex<HashMap<String, Arc<WorkerSlot>>>);
static LIGHTHOUSE_INSTALL: Mutex<()> = Mutex::new(());

/// A future Rust integration must bind this to the original authenticated
/// request and current grant. There is deliberately no permissive default.
/// The same request is checked before allocation and again after the worker lock.
pub type Authorization = Arc<dyn Fn(&str, &Value) -> Result<(), String> + Send + Sync>;

struct WorkerSlot {
    closed: AtomicBool,
    worker: Mutex<Worker>,
}

fn browser_environment(env: HashMap<String, String>) -> HashMap<String, String> {
    env.into_iter()
        .filter(|(name, _)| {
            matches!(
                name.as_str(),
                "PATH"
                    | "HOME"
                    | "TMPDIR"
                    | "LANG"
                    | "LC_ALL"
                    | "USER"
                    | "LOGNAME"
                    | "__CF_USER_TEXT_ENCODING"
            )
        })
        .collect()
}

struct Worker {
    child: Child,
    pgid: Option<i32>,
    input: ChildStdin,
    replies: mpsc::Receiver<Result<String, String>>,
    next: u64,
    root: PathBuf,
    directory: directory::Directory,
}

fn node() -> Result<(PathBuf, HashMap<String, String>), String> {
    let env = crate::env_resolver::cached_user_env()?;
    let path = env.get("PATH").cloned().unwrap_or_default();
    if let Some(runtime) = crate::installer::installed_tools().node {
        let executable = runtime.bin_dir.join("node");
        if executable.is_file() {
            return Ok((executable, env));
        }
    }
    for dir in std::env::split_paths(&path) {
        let executable = dir.join("node");
        if executable.is_file() {
            return Ok((executable, env));
        }
    }
    Err("Install Node.js to use Chromium diagnostics.".into())
}

fn resource(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/browser-cdp");
    if bundled.join("main.mjs").is_file() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/browser-cdp");
    if cfg!(debug_assertions) && development.join("main.mjs").is_file() {
        return Ok(development);
    }
    Err("The Chromium browser worker is missing from this build.".into())
}

impl Worker {
    fn start(app: &AppHandle, root: PathBuf) -> Result<Self, String> {
        let (node, env) = node()?;
        let runtime = resource(app)?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("browser-debug");
        let directory = directory::Directory::create(&data)?;
        let mut command = crate::spawn::command(node);
        command.process_group(0);
        command
            .arg(runtime.join("main.mjs"))
            .current_dir(&root)
            .env_clear()
            .envs(browser_environment(env))
            .env("ZORVO_BROWSER_ROOT", &root)
            .env("ZORVO_BROWSER_DIRECTORY", directory.path())
            .env(
                "ZORVO_LIGHTHOUSE_PATH",
                data.join("lighthouse/node_modules/lighthouse/cli/index.js"),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        Self::spawn(command, root, directory)
    }

    fn spawn(
        mut command: std::process::Command,
        root: PathBuf,
        directory: directory::Directory,
    ) -> Result<Self, String> {
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let input = child.stdin.take().ok_or("Browser worker has no input.")?;
        let output = child.stdout.take().ok_or("Browser worker has no output.")?;
        let (send, replies) = mpsc::sync_channel(4);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = String::new();
                let read = reader
                    .by_ref()
                    .take(8 * 1024 * 1024 + 1)
                    .read_line(&mut line);
                let message = match read {
                    Ok(0) => break,
                    Ok(_) if line.len() <= 8 * 1024 * 1024 && line.ends_with('\n') => Ok(line),
                    _ => Err("Browser worker returned an invalid or oversized reply.".into()),
                };
                let failed = message.is_err();
                if send.send(message).is_err() || failed {
                    break;
                }
            }
        });
        let pgid = Some(child.id() as i32);
        Ok(Self {
            child,
            pgid,
            input,
            replies,
            next: 0,
            root,
            directory,
        })
    }

    fn execute(&mut self, args: Value) -> Result<Value, String> {
        self.execute_with_deadline(args, Duration::from_secs(120))
    }

    fn execute_with_deadline(&mut self, args: Value, deadline: Duration) -> Result<Value, String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            self.terminate();
            return Err(
                "Chromium worker has ended; close the debug browser and open it again.".into(),
            );
        }
        self.next += 1;
        let id = self.next;
        if let Err(error) = writeln!(self.input, "{}", json!({"id":id,"args":args}))
            .and_then(|_| self.input.flush())
        {
            self.terminate();
            return Err(error.to_string());
        }
        let reply = match self.replies.recv_timeout(deadline) {
            Ok(Ok(reply)) => reply,
            Ok(Err(error)) => {
                self.terminate();
                return Err(error);
            }
            Err(_) => {
                self.terminate();
                return Err(
                    "Chromium operation exceeded its deadline; its worker was stopped.".into(),
                );
            }
        };
        let reply: Value = match serde_json::from_str(&reply) {
            Ok(reply) => reply,
            Err(_) => {
                self.terminate();
                return Err("Invalid Chromium reply.".into());
            }
        };
        if reply["id"] != id {
            self.terminate();
            return Err("Chromium reply did not match its request.".into());
        }
        if let Some(error) = reply.get("error").filter(|e| !e.is_null()) {
            return Err(error
                .as_str()
                .unwrap_or("Chromium operation failed.")
                .to_string());
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    fn terminate(&mut self) {
        if let Some(pgid) = self.pgid.take() {
            // Only this worker's process group, created by process_group(0).
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
            let _ = self.child.wait();
        }
        self.directory.remove();
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        // EOF asks the worker to close Chromium and remove its isolated profile.
        let _ = writeln!(
            self.input,
            "{}",
            json!({"id":0,"args":{"operation":"shutdown"}})
        );
        for _ in 0..30 {
            if self.child.try_wait().ok().flatten().is_some() {
                self.terminate();
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.terminate();
    }
}

fn session_tab_list(mut value: Value, session: &str) -> Result<Value, String> {
    let object = value
        .as_object_mut()
        .ok_or("The debug browser returned an invalid tab list.")?;
    object.insert("sessionId".into(), Value::String(session.into()));
    Ok(value)
}

pub async fn execute(
    app: AppHandle,
    session: String,
    root: PathBuf,
    args: Value,
    authorize: Authorization,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorize(&session, &args)?;
        let state = app.state::<DebugBrowsers>();
        let worker = {
            let mut workers = state
                .0
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            if let Some(worker) = workers.get(&session) {
                Arc::clone(worker)
            } else {
                if args["operation"] == "tabs.list" {
                    return session_tab_list(
                        json!({"tabs":[],"activeTabId":null,"engine":"chromium"}),
                        &session,
                    );
                }
                if workers.len() >= 8 {
                    return Err("Close a debug browser session before opening another.".into());
                }
                let worker = Arc::new(WorkerSlot {
                    closed: AtomicBool::new(false),
                    worker: Mutex::new(Worker::start(&app, root.clone())?),
                });
                workers.insert(session.clone(), Arc::clone(&worker));
                worker
            }
        };
        let slot = worker;
        let mut worker = slot
            .worker
            .lock()
            .map_err(|_| "Browser worker is unavailable.")?;
        if slot.closed.load(Ordering::Acquire) {
            return Err("This debug browser has closed.".into());
        }
        authorize(&session, &args)?;
        if worker.root != root {
            return Err("The session's workspace changed; close its debug browser first.".into());
        }
        let mut args = args;
        if let Some(object) = args.as_object_mut() {
            object.remove("_zorvoCallId");
            object.remove("_zorvoGrant");
        }
        let closing_last = args["operation"] == "tabs.close";
        let listing = args["operation"] == "tabs.list";
        let result = worker.execute(args).and_then(|value| {
            if listing {
                session_tab_list(value, &session)
            } else {
                Ok(value)
            }
        });
        let idle = result.as_ref().is_ok_and(|value| {
            (closing_last && value["remainingTabs"] == 0)
                || (listing && value["tabs"].as_array().is_some_and(Vec::is_empty))
        });
        if idle {
            let mut workers = state
                .0
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            if workers
                .get(&session)
                .is_some_and(|current| Arc::ptr_eq(current, &slot))
            {
                slot.closed.store(true, Ordering::Release);
                workers.remove(&session);
            }
        }
        drop(worker);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn close(app: &AppHandle, session: Option<&str>) {
    let state = app.state::<DebugBrowsers>();
    let removed: Vec<_> = {
        let mut workers = state.0.lock().unwrap_or_else(|e| e.into_inner());
        match session {
            Some(id) => workers.remove(id).into_iter().collect(),
            None => workers.drain().map(|(_, w)| w).collect(),
        }
    };
    for worker in &removed {
        worker.closed.store(true, Ordering::Release);
    }
    std::thread::spawn(move || drop(removed));
}

/// Startup cleanup never touches a live worker's locked directory or follows symlinks.
pub fn sweep(app: &AppHandle) {
    let Ok(data) = app.path().app_data_dir() else {
        return;
    };
    std::thread::spawn(move || {
        let _ = directory::sweep(&data.join("browser-debug"));
    });
}

// Plain Rust helpers only. An approved integration must add authenticated
// asynchronous IPC wrappers; this proposal declares no Tauri commands.
pub async fn runtime_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_runtime_status(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn read_runtime_status(app: &AppHandle) -> Result<Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-debug/lighthouse");
    Ok(
        json!({"installed":root.join("node_modules/lighthouse/cli/index.js").is_file(),"version":"13.6.0"}),
    )
}

pub async fn install_runtime(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _install = LIGHTHOUSE_INSTALL
            .lock()
            .map_err(|_| "The audit installer is unavailable.")?;
        let (node, env) = node()?;
        let runtime = resource(&app)?.join("lighthouse-runtime");
        let destination = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("browser-debug/lighthouse");
        std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        for name in ["package.json", "package-lock.json"] {
            std::fs::copy(runtime.join(name), destination.join(name)).map_err(|e| e.to_string())?;
        }
        let npm = node
            .parent()
            .ok_or("Node installation is incomplete.")?
            .join("npm");
        let npm = std::fs::canonicalize(npm)
            .map_err(|_| "npm is missing from this Node.js installation.")?;
        let mut command = crate::spawn::command(node);
        command.arg(npm);
        command
            .args([
                "ci",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--registry=https://registry.npmjs.org",
            ])
            .current_dir(&destination)
            .env_clear()
            .envs(env)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                if !status.success() {
                    return Err(
                        "Lighthouse installation failed. Check Node.js and npm connectivity."
                            .into(),
                    );
                }
                break;
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Lighthouse installation exceeded three minutes.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        read_runtime_status(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chromium_tab_lists_use_the_authoritative_session_for_ui_ownership() {
        let tabs = json!([{"id":"t1","url":"https://example.com/","title":"Example", "loading":false,"canGoBack":false,"canGoForward":false}]);
        let populated = session_tab_list(
            json!({"tabs":tabs,"activeTabId":"t1","engine":"chromium","sessionId":"untrusted"}),
            "owner",
        )
        .unwrap();
        assert_eq!(populated["sessionId"], "owner");
        assert_eq!(populated["tabs"], tabs);
        assert_eq!(populated["activeTabId"], "t1");
        let empty = session_tab_list(
            json!({"tabs":[],"activeTabId":null,"engine":"chromium"}),
            "owner",
        )
        .unwrap();
        assert_eq!(empty["sessionId"], "owner");
        assert_eq!(empty["tabs"], json!([]));
        assert!(session_tab_list(Value::Null, "owner").is_err());
    }
    #[test]
    fn browser_processes_receive_no_login_credentials_or_node_injection_options() {
        let env = HashMap::from([
            ("PATH".into(), "/usr/bin".into()),
            ("OPENAI_API_KEY".into(), "test".into()),
            ("NODE_OPTIONS".into(), "--require untrusted".into()),
            ("ZORVO_MCP_TOKEN".into(), "test".into()),
        ]);
        assert_eq!(
            browser_environment(env),
            HashMap::from([("PATH".into(), "/usr/bin".into())])
        );
    }
    #[test]
    fn an_exited_worker_leader_does_not_leave_its_owned_descendant_running() {
        let temp = crate::artifacts::test_support::Temp::new("debug-descendant");
        let directory = directory::Directory::create(&temp.0.join("browser-debug")).unwrap();
        let owned = directory.path().to_owned();
        std::fs::create_dir(owned.join("profile")).unwrap();
        std::fs::write(owned.join("profile/Cookies"), "private cookies").unwrap();
        std::fs::create_dir(owned.join("upload-1")).unwrap();
        std::fs::write(owned.join("upload-1/workspace.txt"), "approved bytes").unwrap();
        let mut command = crate::spawn::command("/bin/sh");
        command
            .args(["-c", "/bin/sleep 30 & printf '%s\\n' \"$!\""])
            .current_dir(std::env::temp_dir())
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        let mut child = command.spawn().unwrap();
        let pgid = child.id() as i32;
        let input = child.stdin.take().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let descendant: i32 = line.trim().parse().unwrap();
        assert!(child.wait().unwrap().success());
        // SAFETY: signal 0 checks the parsed child PID without dereferencing pointers.
        assert_eq!(unsafe { libc::kill(descendant, 0) }, 0);
        let (_, replies) = mpsc::channel();
        let mut worker = Worker {
            child,
            pgid: Some(pgid),
            input,
            replies,
            next: 0,
            root: std::env::temp_dir(),
            directory,
        };
        worker.terminate();
        assert!(
            !owned.exists(),
            "the Rust owner left private worker files behind"
        );
        let output = crate::spawn::command("ps")
            .args(["-p", &descendant.to_string(), "-o", "stat="])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&output.stdout);
        assert!(
            state.trim().is_empty() || state.trim().starts_with('Z'),
            "owned descendant still runs: {state}"
        );
    }

    #[test]
    fn an_oversized_real_worker_reply_kills_the_process_and_removes_its_private_folder() {
        let temp = crate::artifacts::test_support::Temp::new("debug-oversized");
        let directory = directory::Directory::create(&temp.0.join("browser-debug")).unwrap();
        let owned = directory.path().to_owned();
        std::fs::write(owned.join("trace.json"), "private trace").unwrap();
        let mut command = crate::spawn::command("node");
        command.args(["-e", "process.stdin.once('data',()=>process.stdout.write('x'.repeat(8*1024*1024+2)+'\\n'));setInterval(()=>{},1000)"])
            .process_group(0).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut worker = Worker::spawn(command, temp.0.clone(), directory).unwrap();
        let error = worker
            .execute(json!({"operation":"tabs.list"}))
            .unwrap_err();
        assert!(error.contains("oversized"), "{error}");
        assert!(worker.child.try_wait().unwrap().is_some());
        assert!(!owned.exists());
    }

    #[test]
    fn a_real_worker_deadline_removes_its_profile_and_staged_uploads() {
        let temp = crate::artifacts::test_support::Temp::new("debug-timeout");
        let directory = directory::Directory::create(&temp.0.join("browser-debug")).unwrap();
        let owned = directory.path().to_owned();
        std::fs::create_dir(owned.join("profile")).unwrap();
        std::fs::write(owned.join("profile/Cookies"), "private cookies").unwrap();
        std::fs::create_dir(owned.join("upload-1")).unwrap();
        std::fs::write(owned.join("upload-1/workspace.txt"), "approved bytes").unwrap();
        let mut command = crate::spawn::command("node");
        command
            .args(["-e", "process.stdin.resume();setInterval(()=>{},1000)"])
            .process_group(0)
            .stderr(Stdio::null());
        let mut worker = Worker::spawn(command, temp.0.clone(), directory).unwrap();
        let error = worker
            .execute_with_deadline(json!({"operation":"tabs.list"}), Duration::from_millis(20))
            .unwrap_err();
        assert!(error.contains("deadline"), "{error}");
        assert!(worker.child.try_wait().unwrap().is_some());
        assert!(!owned.exists());
    }
}
