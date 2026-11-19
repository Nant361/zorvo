//! The `zorvo-artifact` protocol: how a stored page reaches its own webview.
//!
//! Registered on the artifact's child webview only, never on the main one.
//! A URL names a session, an artifact and a version; the webview never sends a
//! path. The page's limits are the CSP sent with every answer.

use tauri::http::Response;

use super::store::{is_artifact_id, is_session_id, ArtifactStore};

pub const SCHEME: &str = "zorvo-artifact";
const ORIGIN: &str = "zorvo-artifact://localhost/";

/// What a page may load. Scripts and fonts come from the hosts Claude's
/// artifacts use; nothing can be fetched, framed or posted, and
/// `sandbox allow-scripts` gives the page an opaque origin, so it keeps no
/// storage and shares nothing with another artifact. Changing this changes a
/// security boundary: `the_page_csp_is_exactly` makes that a visible diff.
pub const PAGE_CSP: &str = "default-src 'none'; \
script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
style-src 'unsafe-inline' https://fonts.googleapis.com; \
font-src https://fonts.gstatic.com data:; \
img-src data: blob:; \
media-src data: blob:; \
connect-src 'none'; frame-src 'none'; object-src 'none'; \
form-action 'none'; base-uri 'none'; \
sandbox allow-scripts";

pub fn page_url(session_id: &str, artifact_id: &str, version: u32) -> String {
    format!("{ORIGIN}{session_id}/{artifact_id}/{version}")
}

/// The session, artifact and version a page URL names; a query or fragment is ignored.
pub fn parse_url(uri: &str) -> Option<(String, String, u32)> {
    let path = uri.strip_prefix(ORIGIN)?;
    let path = path.split(['?', '#']).next()?;
    let mut parts = path.split('/');
    let (session_id, artifact_id, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || !is_session_id(session_id) || !is_artifact_id(artifact_id) {
        return None;
    }
    let is_plain_number = !version.is_empty() && version.chars().all(|c| c.is_ascii_digit());
    let version = version
        .parse::<u32>()
        .ok()
        .filter(|n| is_plain_number && *n > 0)?;
    Some((session_id.to_string(), artifact_id.to_string(), version))
}

/// The bytes sent for a stored page. Unchanged today; a later spec adds
/// Zorvo's comment script here, and export must keep writing the stored bytes.
pub fn served_body(stored: Vec<u8>) -> Vec<u8> {
    stored
}

fn not_found() -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = tauri::http::StatusCode::NOT_FOUND;
    response
}

/// Answers one request from the artifact's webview.
pub fn respond(store: &ArtifactStore, method: &str, uri: &str) -> Response<Vec<u8>> {
    if method != "GET" {
        return not_found();
    }
    let stored = parse_url(uri)
        .and_then(|(session_id, artifact_id, version)| {
            store.version_path(&session_id, &artifact_id, version)
        })
        .and_then(|path| std::fs::read(path).ok());
    let Some(stored) = stored else {
        return not_found();
    };
    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", PAGE_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(served_body(stored))
        .unwrap_or_else(|_| not_found())
}

/// Whether the artifact's webview may go to `url`: only to an artifact page.
/// This is the only thing between a page and the open web.
pub fn is_allowed_navigation(url: &str) -> bool {
    parse_url(url).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::test_support::Temp;

    const SESSION: &str = "session-1794800000000-k3x9a";

    /// A store holding one artifact with one version; returns its id.
    fn stored(temp: &Temp, body: &[u8]) -> (ArtifactStore, String) {
        let store = ArtifactStore::new(temp.0.clone());
        let id = store
            .show(SESSION, "/work/page.html", Some("Page"), body, 1)
            .unwrap()
            .artifact
            .id;
        (store, id)
    }

    fn header<'a>(response: &'a tauri::http::Response<Vec<u8>>, name: &str) -> &'a str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    }

    #[test]
    fn serves_a_stored_version_with_its_headers() {
        let temp = Temp::new("serve");
        let (store, id) = stored(&temp, b"<p>hello</p>");

        let response = respond(&store, "GET", &page_url(SESSION, &id, 1));

        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), b"<p>hello</p>");
        assert_eq!(
            header(&response, "Content-Type"),
            "text/html; charset=utf-8"
        );
        assert_eq!(header(&response, "Content-Security-Policy"), PAGE_CSP);
        assert_eq!(header(&response, "X-Content-Type-Options"), "nosniff");
        assert_eq!(header(&response, "Cache-Control"), "no-store");
    }

    #[test]
    fn the_page_csp_is_exactly() {
        assert_eq!(
            PAGE_CSP,
            "default-src 'none'; \
             script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; \
             style-src 'unsafe-inline' https://fonts.googleapis.com; \
             font-src https://fonts.gstatic.com data:; \
             img-src data: blob:; \
             media-src data: blob:; \
             connect-src 'none'; frame-src 'none'; object-src 'none'; \
             form-action 'none'; base-uri 'none'; \
             sandbox allow-scripts"
        );
    }

    #[test]
    fn the_csp_sandboxes_the_page() {
        assert!(PAGE_CSP.ends_with("; sandbox allow-scripts"));
        assert!(!PAGE_CSP.contains("allow-same-origin"));
        assert!(!PAGE_CSP.contains("unsafe-eval"));
    }

    #[test]
    fn served_body_is_the_stored_page() {
        assert_eq!(served_body(b"<p>a</p>".to_vec()), b"<p>a</p>");
    }

    #[test]
    fn refuses_what_is_not_a_get_of_a_listed_version() {
        let temp = Temp::new("refuse");
        let (store, id) = stored(&temp, b"x");
        let good = page_url(SESSION, &id, 1);

        for (method, uri) in [
            ("POST", good.clone()),
            ("GET", page_url(SESSION, &id, 2)),
            ("GET", page_url("other-session", &id, 1)),
            ("GET", format!("zorvo-artifact://localhost/../{id}/1")),
            ("GET", good.replace("localhost", "evil")),
            ("GET", format!("{good}/extra")),
            ("GET", "zorvo-artifact://localhost/".to_string()),
        ] {
            let response = respond(&store, method, &uri);
            assert_eq!(response.status(), 404, "{method} {uri}");
            assert!(response.body().is_empty());
        }
    }

    #[test]
    fn a_listed_version_whose_file_is_gone_is_404() {
        let temp = Temp::new("gone");
        let (store, id) = stored(&temp, b"x");
        std::fs::remove_file(store.version_path(SESSION, &id, 1).unwrap()).unwrap();

        assert_eq!(
            respond(&store, "GET", &page_url(SESSION, &id, 1)).status(),
            404
        );
    }

    #[test]
    fn page_url_round_trips_through_parse_url() {
        let url = page_url(SESSION, "a-0123456789abcdef", 7);

        assert_eq!(
            url,
            format!("zorvo-artifact://localhost/{SESSION}/a-0123456789abcdef/7")
        );
        assert_eq!(
            parse_url(&url),
            Some((SESSION.to_string(), "a-0123456789abcdef".to_string(), 7))
        );
    }

    #[test]
    fn parse_url_ignores_a_query_and_a_fragment() {
        let url = page_url(SESSION, "a-0123456789abcdef", 7);

        assert!(parse_url(&format!("{url}?r=3")).is_some());
        assert!(parse_url(&format!("{url}#section")).is_some());
        assert!(parse_url(&format!("{url}?r=3#section")).is_some());
    }

    #[test]
    fn parse_url_refuses_other_shapes() {
        let id = "a-0123456789abcdef";
        for url in [
            format!("zorvo-artifact://localhost/{SESSION}/{id}/+1"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/0"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/1.5"),
            format!("zorvo-artifact://localhost/{SESSION}/{id}/"),
            format!("zorvo-artifact://localhost/{SESSION}/bad/1"),
            format!("https://localhost/{SESSION}/{id}/1"),
        ] {
            assert_eq!(parse_url(&url), None, "{url}");
        }
    }

    #[test]
    fn navigation_allows_only_artifact_pages() {
        let page = page_url(SESSION, "a-0123456789abcdef", 1);

        assert!(is_allowed_navigation(&page));
        assert!(is_allowed_navigation(&format!("{page}#section")));
        for url in [
            "https://example.com",
            "http://localhost:1420",
            "file:///etc/hosts",
            "tauri://localhost",
            "zorvo-artifact://evil/",
            "about:blank",
            "javascript:alert(1)",
        ] {
            assert!(!is_allowed_navigation(url), "{url}");
        }
    }
}
