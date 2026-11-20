//! Session-owned native browser views, outside Tauri's privileged webview.

use serde_json::Value;
use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod native;
#[cfg(all(target_os = "macos", debug_assertions))]
mod smoke;
#[cfg(all(target_os = "macos", debug_assertions))]
pub use smoke::smoke;

#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The backend, rather than a page script, decides what a URL may load.
pub fn navigation_url(raw: &str) -> Result<String, String> {
    if raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err("Enter an HTTP or HTTPS URL.".into());
    }
    let url = url::Url::parse(raw).map_err(|_| "Enter an HTTP or HTTPS URL.")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS pages without embedded credentials are allowed.".into());
    }
    Ok(url.into())
}

/// Runs after the caller has granted access to the session. No view is
/// allocated before that grant; manual UI calls have their own command.
pub async fn execute(app: &AppHandle, session_id: String, args: Value) -> Result<Value, String> {
    let mut args = args;
    if let Some(frame) = args.get("frameID").cloned() {
        if args.get("frameId").is_none() {
            args["frameId"] = frame;
        }
    }
    if !crate::artifacts::store::is_session_id(&session_id)
        || !args.is_object()
        || args.to_string().len() > 1024 * 1024
    {
        return Err("Invalid browser request.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let deadline = std::time::Instant::now()
            + std::time::Duration::from_millis(
                args.get("timeoutMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(10000)
                    .clamp(100, 30000),
            );
        loop {
            let result = native::execute(app, session_id.clone(), args.clone()).await;
            if args["operation"] != "wait"
                || result.is_ok()
                || std::time::Instant::now() >= deadline
            {
                return result;
            }
            if !result
                .as_ref()
                .err()
                .is_some_and(|e| e.starts_with("WebKit could not complete the script"))
            {
                return result;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session_id, args);
        Err("The embedded browser requires macOS.".into())
    }
}

#[tauri::command]
pub async fn browser_bounds(
    app: AppHandle,
    session_id: String,
    tab_id: Option<String>,
    bounds: Option<Bounds>,
    visible: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        native::bounds(&app, session_id, tab_id, bounds, visible).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session_id, tab_id, bounds, visible);
        Ok(())
    }
}

pub fn close_session(app: &AppHandle, session_id: String) {
    #[cfg(target_os = "macos")]
    {
        native::close_session(app, session_id);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, session_id);
    }
}

pub fn close_all(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        native::close_all(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_pages_without_credentials_are_navigable() {
        for url in [
            "https://github.com/",
            "http://localhost:3000",
            "http://127.0.0.1:5000/a",
        ] {
            assert!(navigation_url(url).is_ok(), "{url}");
        }
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "zorvo://open",
            "about:blank",
            "https://user:password@host/",
            "https://host/\n",
        ] {
            assert!(navigation_url(url).is_err(), "{url}");
        }
    }
}
