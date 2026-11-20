//! The instruction files an agent loads into its context, for Zorvo's estimate
//! of what fills the window when the agent reports only the total.
//!
//! Only fixed names are looked at: in the session's folder, and in the user's
//! folder of the agent in use. Each file's size comes from its metadata; no
//! file is opened, and no content or absolute path reaches the webview.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::files::ensure_known_workspace;
use crate::store::AppStore;

/// The most one file counts for: a larger one is cut by the agent anyway.
pub const MAX_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstructionFile {
    /// As the user would write it: `CLAUDE.md`, or `~/.claude/CLAUDE.md`.
    pub path: String,
    /// The file's size, at most [`MAX_FILE_BYTES`].
    pub bytes: u64,
}

/// Which names the agent reads in a project folder, and in which folder of
/// the user's home (with the names it reads there).
struct AgentFiles {
    in_folder: &'static [&'static str],
    home: Option<(&'static str, &'static [&'static str])>,
}

fn files_of(agent_id: &str) -> AgentFiles {
    match agent_id {
        "claude-acp" => AgentFiles {
            in_folder: &["CLAUDE.md", "CLAUDE.local.md"],
            home: Some((".claude", &["CLAUDE.md"])),
        },
        "codex-acp" => AgentFiles {
            in_folder: &["AGENTS.md"],
            home: Some((".codex", &["AGENTS.md"])),
        },
        "qwen-code" => AgentFiles {
            in_folder: &["QWEN.md", "AGENTS.md"],
            home: Some((".qwen", &["QWEN.md", "AGENTS.md"])),
        },
        "gemini" | "antigravity-acp" => AgentFiles {
            in_folder: &["GEMINI.md"],
            home: Some((".gemini", &["GEMINI.md"])),
        },
        "pi-acp" => AgentFiles {
            in_folder: &["AGENTS.md"],
            home: Some((".pi/agent", &["AGENTS.md"])),
        },
        _ => AgentFiles {
            in_folder: &["AGENTS.md"],
            home: None,
        },
    }
}

/// The instruction files `agent_id` would load for a session in `root`.
#[tauri::command(async)]
pub fn instruction_files(
    store: State<'_, AppStore>,
    root: String,
    agent_id: String,
) -> Result<Vec<InstructionFile>, String> {
    ensure_known_workspace(&root, |r| store.is_known_workspace(r))?;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    Ok(found_in(Path::new(&root), home.as_deref(), &agent_id))
}

fn found_in(root: &Path, home: Option<&Path>, agent_id: &str) -> Vec<InstructionFile> {
    let files = files_of(agent_id);
    let in_folder = files
        .in_folder
        .iter()
        .filter_map(|name| sized(&root.join(name), name.to_string()));
    let in_home = files
        .home
        .zip(home)
        .into_iter()
        .flat_map(|((folder, names), home)| {
            names.iter().filter_map(move |name| {
                sized(&home.join(folder).join(name), format!("~/{folder}/{name}"))
            })
        });
    in_folder.chain(in_home).collect()
}

/// The file's size, when it is a regular file (a link counts by its target).
fn sized(path: &Path, shown: String) -> Option<InstructionFile> {
    let meta = std::fs::metadata(path).ok()?;
    meta.is_file().then(|| InstructionFile {
        path: shown,
        bytes: meta.len().min(MAX_FILE_BYTES),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A folder of its own under the system's temp folder, removed afterwards.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is before the unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zorvo-instructions-{tag}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create scratch folder");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_the_agents_own_names_in_the_folder_and_the_home() {
        let dir = Scratch::new("both");
        let (root, home) = (dir.path().join("p"), dir.path().join("h"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::write(root.join("CLAUDE.md"), "x".repeat(40)).unwrap();
        fs::write(root.join("AGENTS.md"), "not read by Claude").unwrap();
        fs::write(home.join(".claude/CLAUDE.md"), "y".repeat(8)).unwrap();

        let found = found_in(&root, Some(&home), "claude-acp");

        assert_eq!(
            found,
            vec![
                InstructionFile {
                    path: "CLAUDE.md".into(),
                    bytes: 40
                },
                InstructionFile {
                    path: "~/.claude/CLAUDE.md".into(),
                    bytes: 8
                },
            ]
        );
    }

    #[test]
    fn caps_the_size_and_skips_folders() {
        let dir = Scratch::new("cap");
        fs::write(
            dir.path().join("AGENTS.md"),
            vec![b'a'; (MAX_FILE_BYTES + 10) as usize],
        )
        .unwrap();
        fs::create_dir(dir.path().join("QWEN.md")).unwrap();

        let found = found_in(dir.path(), None, "qwen-code");

        assert_eq!(
            found,
            vec![InstructionFile {
                path: "AGENTS.md".into(),
                bytes: MAX_FILE_BYTES
            }]
        );
    }

    #[test]
    fn an_unknown_agent_gets_agents_md_only() {
        let dir = Scratch::new("unknown");
        fs::write(dir.path().join("AGENTS.md"), "a").unwrap();
        fs::write(dir.path().join("CLAUDE.md"), "c").unwrap();

        let names: Vec<_> = found_in(dir.path(), Some(dir.path()), "someone-else")
            .into_iter()
            .map(|f| f.path)
            .collect();

        assert_eq!(names, vec!["AGENTS.md"]);
    }
}
