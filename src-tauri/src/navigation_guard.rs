//! Keeps Zorvo's own windows on Zorvo's own page.
//!
//! A link an agent wrote must open in the user's browser, never inside the app's webview: the page
//! would replace Zorvo with no way back. The link menu and `ExternalLink` already send links to
//! `open_external_url`; this is the net under them for any path they miss (WebKit's own menu, a
//! drag, a form). It covers every window Tauri makes (the main one and session popouts). The
//! artifact page is a wry webview of its own with its own handler (`artifacts/view.rs`).

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

/// What happens to a navigation of one of Zorvo's windows.
#[derive(Debug, PartialEq, Eq)]
pub enum Navigation {
    /// Zorvo's own page, or a blank frame a library makes.
    Allow,
    /// A web or mail address: refused here and handed to the user's browser or mail app.
    OpenOutside,
    /// Anything else (a file, a data URL, an unknown scheme): refused and dropped.
    Refuse,
}

/// The verdict for `url`. `dev_url` is the dev server's address, given only in a debug build.
pub fn verdict(url: &Url, dev_url: Option<&Url>) -> Navigation {
    if is_app_page(url, dev_url) {
        return Navigation::Allow;
    }
    match url.scheme() {
        "http" | "https" | "mailto" => Navigation::OpenOutside,
        _ => Navigation::Refuse,
    }
}

fn is_app_page(url: &Url, dev_url: Option<&Url>) -> bool {
    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost");
    let blank = url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc");
    let dev_server = dev_url.is_some_and(|dev| {
        dev.scheme() == url.scheme()
            && dev.host_str() == url.host_str()
            && dev.port_or_known_default() == url.port_or_known_default()
    });
    bundled || blank || dev_server
}

/// The plugin that applies `verdict` to every navigation of every Tauri webview.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            // A release build serves its page from `tauri://localhost`; only a debug build has a dev server.
            let dev_url = cfg!(debug_assertions)
                .then(|| webview.app_handle().config().build.dev_url.clone())
                .flatten();
            match verdict(url, dev_url.as_ref()) {
                Navigation::Allow => true,
                Navigation::OpenOutside => {
                    let address = url.to_string();
                    // `open` is a child process; the navigation callback runs on the main thread.
                    std::thread::spawn(move || {
                        if let Err(error) = crate::windows::open_external_url(address) {
                            eprintln!("navigation guard: {error}");
                        }
                    });
                    false
                }
                Navigation::Refuse => false,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("test URL parses")
    }

    #[test]
    fn allows_the_bundled_page_and_blank_frames() {
        assert_eq!(
            verdict(&url("tauri://localhost/index.html"), None),
            Navigation::Allow
        );
        assert_eq!(
            verdict(
                &url("tauri://localhost/index.html?session=abc&popout=1"),
                None
            ),
            Navigation::Allow
        );
        assert_eq!(verdict(&url("about:blank"), None), Navigation::Allow);
        assert_eq!(verdict(&url("about:srcdoc"), None), Navigation::Allow);
    }

    #[test]
    fn allows_the_dev_server_only_when_it_is_given() {
        let dev = url("http://localhost:1420");
        assert_eq!(
            verdict(&url("http://localhost:1420/"), Some(&dev)),
            Navigation::Allow
        );
        assert_eq!(
            verdict(
                &url("http://localhost:1420/index.html?session=x"),
                Some(&dev)
            ),
            Navigation::Allow
        );
        // A release build passes no dev URL, so the same address leaves for the browser.
        assert_eq!(
            verdict(&url("http://localhost:1420/"), None),
            Navigation::OpenOutside
        );
        // Another port on the same host is not Zorvo's page.
        assert_eq!(
            verdict(&url("http://localhost:3000/"), Some(&dev)),
            Navigation::OpenOutside
        );
    }

    #[test]
    fn sends_web_and_mail_links_to_the_users_apps() {
        for link in [
            "https://github.com/miqdadbadjuber/anti-slop/issues/68",
            "http://example.com/",
            "mailto:team@example.com",
        ] {
            assert_eq!(verdict(&url(link), None), Navigation::OpenOutside, "{link}");
        }
    }

    #[test]
    fn refuses_everything_else_without_opening_it() {
        for link in [
            "file:///etc/hosts",
            "data:text/html,<p>hi</p>",
            "javascript:alert(1)",
            "tauri://evil.example/",
            "ftp://example.com/",
            "about:config",
        ] {
            assert_eq!(verdict(&url(link), None), Navigation::Refuse, "{link}");
        }
    }
}
