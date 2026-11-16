//! The commands the webview calls for artifacts. The logic is in plain
//! functions so it can be tested without Tauri.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use super::protocol::page_url;
use super::source::{read_source, temp_roots};
use super::store::{is_artifact_id, is_session_id, ArtifactRecord, ArtifactStore, Shown, FAILED};
use super::view::{self, checked_bounds, Bounds, ShownPage};
use crate::files::{canonical_root, ensure_known_workspace};
use crate::store::AppStore;

/// Emitted with `{ sessionId }` after anything about a session's artifacts changed.
pub const ARTIFACTS_CHANGED: &str = "artifacts-changed";
/// Artifact folders of sessions that no longer exist are removed once this old.
pub const SWEEP_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAIN_WINDOW: &str = "main";
const COULD_NOT_SAVE: &str = "Zorvo could not save that file.";
const DEFAULT_EXPORT_NAME: &str = "Artifact";

/// One session's artifacts, as `artifact_list` returns them.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionArtifacts {
    pub session_id: String,
    pub artifacts: Vec<ArtifactRecord>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// The sessions whose pages the start-up sweep must keep, or `None` when it
/// must not run: a state that could not be read, or one with no sessions. A
/// corrupt `state.json` is set aside and read as an empty state, and an empty
/// list would make every stored page an orphan.
pub fn sessions_to_keep(loaded: Option<Vec<String>>) -> Option<std::collections::HashSet<String>> {
    loaded
        .filter(|sessions| !sessions.is_empty())
        .map(|sessions| sessions.into_iter().collect())
}

/// Reads the agent's file under the path rules and keeps it as a new version.
pub fn show_page(
    artifacts: &ArtifactStore,
    is_known: impl FnOnce(&Path) -> Result<bool, String>,
    session_id: &str,
    cwd: &str,
    path: &str,
    title: Option<&str>,
    now_ms: u64,
) -> Result<Shown, String> {
    ensure_known_workspace(cwd, is_known)?;
    if !is_session_id(session_id) {
        return Err(FAILED.to_string());
    }
    let session_folder = canonical_root(cwd)?;
    let (source_path, html) = read_source(&session_folder, &temp_roots(), path)?;
    artifacts.show(session_id, &source_path, title, &html, now_ms)
}

pub fn list_sessions(artifacts: &ArtifactStore, session_ids: &[String]) -> Vec<SessionArtifacts> {
    session_ids
        .iter()
        .map(|session_id| SessionArtifacts {
            session_id: session_id.clone(),
            artifacts: artifacts.list(session_id).unwrap_or_default(),
        })
        .collect()
}

/// A file name for an exported page: the title's letters, digits, spaces,
/// `-` and `_`, or "Artifact" when nothing is left.
pub fn export_file_name(title: &str) -> String {
    let kept: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .collect();
    let name = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = if name.is_empty() {
        DEFAULT_EXPORT_NAME
    } else {
        &name
    };
    format!("{name}.html")
}

/// The stored bytes of a version the index lists. Export writes exactly these.
pub fn stored_page(
    artifacts: &ArtifactStore,
    session_id: &str,
    artifact_id: &str,
    version: u32,
) -> Result<Vec<u8>, String> {
    artifacts
        .version_path(session_id, artifact_id, version)
        .and_then(|path| std::fs::read(path).ok())
        .ok_or_else(|| FAILED.to_string())
}

/// Deletes, and closes the page that showed what was deleted only when the
/// deletion worked: after a failed one the artifact is still stored, and the
/// viewer still counts its page as shown, so closing it would leave an empty box.
pub fn delete_then_close(
    delete: impl FnOnce() -> Result<(), String>,
    close: impl FnOnce(),
) -> Result<(), String> {
    delete()?;
    close();
    Ok(())
}

fn changed(app: &AppHandle, session_id: &str) {
    let _ = app.emit(
        ARTIFACTS_CHANGED,
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[tauri::command(async)]
pub fn artifact_show(
    app: AppHandle,
    store: State<'_, AppStore>,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    cwd: String,
    path: String,
    title: Option<String>,
) -> Result<Shown, String> {
    let shown = show_page(
        &artifacts,
        |root| store.is_known_workspace(root),
        &session_id,
        &cwd,
        &path,
        title.as_deref(),
        now_ms(),
    )?;
    changed(&app, &session_id);
    Ok(shown)
}

#[tauri::command(async)]
pub fn artifact_list(
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_ids: Vec<String>,
) -> Result<Vec<SessionArtifacts>, String> {
    Ok(list_sessions(&artifacts, &session_ids))
}

#[tauri::command(async)]
pub fn artifact_rename(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    artifact_id: String,
    title: String,
) -> Result<ArtifactRecord, String> {
    let renamed = artifacts.rename(&session_id, &artifact_id, &title)?;
    changed(&app, &session_id);
    Ok(renamed)
}

#[tauri::command(async)]
pub fn artifact_delete(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    artifact_id: String,
) -> Result<(), String> {
    delete_then_close(
        || artifacts.delete(&session_id, &artifact_id),
        || view::close_for(&app, session_id.clone(), Some(artifact_id.clone())),
    )?;
    changed(&app, &session_id);
    Ok(())
}

#[tauri::command(async)]
pub fn artifact_delete_session(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
) -> Result<(), String> {
    delete_then_close(
        || artifacts.delete_session(&session_id),
        || view::close_for(&app, session_id.clone(), None),
    )?;
    changed(&app, &session_id);
    Ok(())
}

/// Asks where to save, then writes the stored page there. `false` when the user cancelled.
#[tauri::command(async)]
pub fn artifact_export(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    artifact_id: String,
    version: u32,
) -> Result<bool, String> {
    let page = stored_page(&artifacts, &session_id, &artifact_id, version)?;
    let title = artifacts
        .list(&session_id)?
        .into_iter()
        .find(|record| record.id == artifact_id)
        .map(|record| record.title)
        .unwrap_or_default();
    let chosen = app
        .dialog()
        .file()
        .set_file_name(export_file_name(&title))
        .add_filter("HTML", &["html"])
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(false);
    };
    let destination = chosen.into_path().map_err(|_| COULD_NOT_SAVE.to_string())?;
    std::fs::write(destination, page).map_err(|_| COULD_NOT_SAVE.to_string())?;
    Ok(true)
}

/// The rectangle clipped to the main window, or `None` when it cannot be shown.
fn bounds_in_window(app: &AppHandle, bounds: Bounds) -> Option<Bounds> {
    let window = app.get_webview_window(MAIN_WINDOW)?;
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    checked_bounds(bounds, size.width, size.height)
}

/// Shows a stored page at a rectangle of the main window, in its own webview.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn artifact_view_show(
    app: AppHandle,
    artifacts: State<'_, Arc<ArtifactStore>>,
    session_id: String,
    artifact_id: String,
    version: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let is_stored = is_session_id(&session_id)
        && is_artifact_id(&artifact_id)
        && artifacts
            .version_path(&session_id, &artifact_id, version)
            .is_some_and(|path| path.is_file());
    let bounds = bounds_in_window(
        &app,
        Bounds {
            x,
            y,
            width,
            height,
        },
    );
    match (is_stored, bounds) {
        (true, Some(bounds)) => view::show(
            &app,
            Arc::clone(&artifacts),
            ShownPage {
                session_id: session_id.clone(),
                artifact_id: artifact_id.clone(),
            },
            page_url(&session_id, &artifact_id, version),
            bounds,
        ),
        _ => {
            view::close(&app);
            Err(view::COULD_NOT_SHOW.to_string())
        }
    }
}

#[tauri::command(async)]
pub fn artifact_view_bounds(app: AppHandle, x: f64, y: f64, width: f64, height: f64) {
    match bounds_in_window(
        &app,
        Bounds {
            x,
            y,
            width,
            height,
        },
    ) {
        Some(bounds) => view::set_bounds(&app, bounds),
        None => view::close(&app),
    }
}

#[tauri::command(async)]
pub fn artifact_view_hide(app: AppHandle, hidden: bool) {
    view::set_hidden(&app, hidden);
}

#[tauri::command(async)]
pub fn artifact_view_close(app: AppHandle) {
    view::close(&app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::source::NOT_ALLOWED;
    use crate::artifacts::test_support::Temp;

    const SESSION: &str = "session-1794800000000-k3x9a";

    fn text(path: &std::path::Path) -> &str {
        path.to_str().expect("utf-8 path")
    }

    #[test]
    fn show_refuses_an_unknown_workspace() {
        let data = Temp::new("data");
        let work = Temp::new("work");
        std::fs::write(work.0.join("page.html"), b"x").unwrap();
        let artifacts = ArtifactStore::new(data.0.clone());

        let shown = show_page(
            &artifacts,
            |_| Ok(false),
            SESSION,
            text(&work.0),
            "page.html",
            Some("T"),
            1,
        );

        assert!(shown.is_err());
        assert!(artifacts.list(SESSION).unwrap().is_empty());
    }

    #[test]
    fn show_refuses_a_bad_session_id() {
        let data = Temp::new("data");
        let work = Temp::new("work");
        std::fs::write(work.0.join("page.html"), b"x").unwrap();
        let artifacts = ArtifactStore::new(data.0.clone());

        let shown = show_page(
            &artifacts,
            |_| Ok(true),
            "../x",
            text(&work.0),
            "page.html",
            Some("T"),
            1,
        );

        assert!(shown.is_err());
        assert!(std::fs::read_dir(&data.0).unwrap().next().is_none());
    }

    #[test]
    fn show_stores_what_the_file_held() {
        let data = Temp::new("data");
        let work = Temp::new("work");
        let page = work.0.join("page.html");
        std::fs::write(&page, b"<p>one</p>").unwrap();
        let artifacts = ArtifactStore::new(data.0.clone());

        let shown = show_page(
            &artifacts,
            |_| Ok(true),
            SESSION,
            text(&work.0),
            "page.html",
            Some("T"),
            7,
        )
        .unwrap();
        // The agent's file changes afterwards; the stored version does not.
        std::fs::write(&page, b"<p>two</p>").unwrap();

        assert_eq!(shown.version, 1);
        assert_eq!(shown.artifact.source_path, text(&page));
        let stored = artifacts
            .version_path(SESSION, &shown.artifact.id, 1)
            .unwrap();
        assert_eq!(std::fs::read(stored).unwrap(), b"<p>one</p>");
    }

    #[test]
    fn show_passes_a_path_refusal_on_unchanged() {
        let data = Temp::new("data");
        let work = Temp::new("work");
        let artifacts = ArtifactStore::new(data.0.clone());

        let shown = show_page(
            &artifacts,
            |_| Ok(true),
            SESSION,
            text(&work.0),
            "/etc/hosts",
            Some("T"),
            1,
        );

        assert_eq!(shown.unwrap_err(), NOT_ALLOWED);
    }

    #[test]
    fn list_returns_each_session_asked_for() {
        let data = Temp::new("data");
        let artifacts = ArtifactStore::new(data.0.clone());
        artifacts
            .show("one-1", "/w/a.html", Some("A"), b"a", 1)
            .unwrap();

        let listed = list_sessions(
            &artifacts,
            &["one-1".to_string(), "two-2".to_string(), "../x".to_string()],
        );

        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0].session_id, "one-1");
        assert_eq!(listed[0].artifacts.len(), 1);
        assert!(listed[1].artifacts.is_empty());
        assert!(listed[2].artifacts.is_empty());
    }

    #[test]
    fn the_sweep_needs_a_state_that_lists_sessions() {
        let known = sessions_to_keep(Some(vec!["s-1".to_string(), "s-2".to_string()])).unwrap();
        assert!(known.contains("s-1") && known.contains("s-2"));
        // A state that could not be read, or one with no sessions (a corrupt file is replaced by an
        // empty state), says nothing about which pages are orphans: nothing may be swept.
        assert!(sessions_to_keep(None).is_none());
        assert!(sessions_to_keep(Some(Vec::new())).is_none());
    }

    #[test]
    fn the_page_is_closed_only_once_its_artifact_is_deleted() {
        let closed = std::cell::Cell::new(0);

        let failed = delete_then_close(|| Err("no".to_string()), || closed.set(closed.get() + 1));
        assert_eq!(failed, Err("no".to_string()));
        // The artifact is still stored, so the page showing it must stay.
        assert_eq!(closed.get(), 0);

        let deleted = delete_then_close(|| Ok(()), || closed.set(closed.get() + 1));
        assert_eq!(deleted, Ok(()));
        assert_eq!(closed.get(), 1);
    }

    #[test]
    fn export_name_is_safe() {
        assert_eq!(
            export_file_name("Q3 / report: final"),
            "Q3 report final.html"
        );
        assert_eq!(export_file_name("  ../../etc/passwd "), "etcpasswd.html");
        assert_eq!(export_file_name("…"), "Artifact.html");
        assert_eq!(export_file_name(""), "Artifact.html");
        assert_eq!(export_file_name("Séances d'été"), "Séances dété.html");
    }

    #[test]
    fn export_reads_the_stored_bytes_of_a_listed_version_only() {
        let data = Temp::new("data");
        let artifacts = ArtifactStore::new(data.0.clone());
        let id = artifacts
            .show(SESSION, "/w/a.html", Some("A"), b"<p>a</p>", 1)
            .unwrap()
            .artifact
            .id;

        assert_eq!(
            stored_page(&artifacts, SESSION, &id, 1).unwrap(),
            b"<p>a</p>"
        );
        assert!(stored_page(&artifacts, SESSION, &id, 2).is_err());
        assert!(stored_page(&artifacts, "../x", &id, 1).is_err());
    }
}
