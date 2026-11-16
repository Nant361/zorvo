//! The artifact page's own webview: a child of the main window, placed over
//! the box the main webview leaves for it.
//!
//! It is made with wry directly, so Tauri never sees it: no IPC script, no
//! invoke key and no message handler exist inside it. It has its own web
//! content process, so a page that never yields cannot stop Zorvo's interface
//! (a frame inside the main webview does; see the spec's spike results).
//! There is one at a time, and it lives on the main thread.

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use super::protocol::{is_allowed_navigation, respond, SCHEME};
use super::store::ArtifactStore;

const MAIN_WINDOW: &str = "main";
pub const COULD_NOT_SHOW: &str = "Zorvo could not show that page.";

/// Which stored page the view shows, so deleting another session's pages leaves it alone.
#[derive(Clone, Debug, PartialEq)]
pub struct ShownPage {
    pub session_id: String,
    pub artifact_id: String,
}

/// What decides whether the view is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Display {
    /// The page has finished loading. Until then the view is not drawn: a new
    /// webview is white, which flashes in a dark window before the page paints.
    pub is_loaded: bool,
    /// Something of Zorvo's is drawn where the page is.
    pub is_hidden: bool,
}

pub fn is_visible(display: Display) -> bool {
    display.is_loaded && !display.is_hidden
}

/// A page that has not said it loaded is shown anyway after this long, so one
/// that never finishes loading is still seen (and can be reloaded).
const SHOW_ANYWAY_AFTER: std::time::Duration = std::time::Duration::from_secs(3);

thread_local! {
    /// The one child webview and what it shows. `wry::WebView` is not `Send`, so it stays here.
    static VIEW: RefCell<Option<(wry::WebView, ShownPage)>> = const { RefCell::new(None) };
    static DISPLAY: Cell<Display> = const { Cell::new(Display { is_loaded: false, is_hidden: false }) };
    /// Counts the views made, so a late "loaded" for an earlier view changes nothing.
    static GENERATION: Cell<u64> = const { Cell::new(0) };
}

/// Changes what decides the view's visibility and applies it. Main thread only.
fn update_display(change: impl FnOnce(Display) -> Display) {
    let display = change(DISPLAY.get());
    DISPLAY.set(display);
    VIEW.with(|slot| {
        if let Some((view, _)) = slot.borrow().as_ref() {
            let _ = view.set_visible(is_visible(display));
        }
    });
}

/// Marks the view of `generation` as loaded, if it is still the one shown. Main thread only.
fn mark_loaded(generation: u64) {
    if GENERATION.get() == generation {
        update_display(|display| Display {
            is_loaded: true,
            ..display
        });
    }
}

/// Whether the view shows a page of `session_id` (and, when one is named, of that artifact).
pub fn is_showing(shown: Option<&ShownPage>, session_id: &str, artifact_id: Option<&str>) -> bool {
    shown.is_some_and(|page| {
        page.session_id == session_id && artifact_id.is_none_or(|id| page.artifact_id == id)
    })
}

/// Ends a view: its page's process first, then the view.
///
/// Dropping a `wry::WebView` only takes it out of the window: wry keeps the
/// `WKWebView` alive on purpose, so its web content process would go on
/// running, and a page that loops would hold a core until Zorvo quit (seen in
/// the spike: 98% of a core, 16 s after the drop). WebKit has no public call
/// that ends the process of a page that does not yield, so this asks for it by
/// the name WebKit's own tools use, and only when the view answers to it; on a
/// macOS where it does not, the page is merely hidden, as before.
fn end(view: wry::WebView) {
    use objc2::{msg_send, sel};
    use wry::WebViewExtMacOS;
    let webview = view.webview();
    // SAFETY: both messages go to a live WKWebView on the main thread (every
    // caller runs there), and the second is sent only when the first says the
    // object answers it; it takes no arguments and returns nothing.
    unsafe {
        let responds: bool = msg_send![&*webview, respondsToSelector: sel!(_killWebContentProcess)];
        if responds {
            let _: () = msg_send![&*webview, _killWebContentProcess];
        }
    }
    drop(view);
}

/// Takes the view out of its slot and ends it. Main thread only.
fn end_current() {
    if let Some((view, _)) = VIEW.with(|slot| slot.borrow_mut().take()) {
        end(view);
    }
}

/// A rectangle in the main window, in logical points from its top-left corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// `bounds` clipped to a window of the given size, or `None` when a number is
/// not finite, the size is not positive, or nothing of it is inside the window.
pub fn checked_bounds(bounds: Bounds, window_width: f64, window_height: f64) -> Option<Bounds> {
    let numbers = [
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        window_width,
        window_height,
    ];
    if numbers.iter().any(|n| !n.is_finite()) || bounds.width <= 0.0 || bounds.height <= 0.0 {
        return None;
    }
    let left = bounds.x.max(0.0);
    let top = bounds.y.max(0.0);
    let right = (bounds.x + bounds.width).min(window_width);
    let bottom = (bounds.y + bounds.height).min(window_height);
    (right > left && bottom > top).then_some(Bounds {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

fn rect(bounds: Bounds) -> wry::Rect {
    wry::Rect {
        position: wry::dpi::LogicalPosition::new(bounds.x, bounds.y).into(),
        size: wry::dpi::LogicalSize::new(bounds.width, bounds.height).into(),
    }
}

/// Shows the page at `url` in a new webview at `bounds`, ending any earlier one.
pub fn show(
    app: &AppHandle,
    store: Arc<ArtifactStore>,
    page: ShownPage,
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let (sent, received) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        // Ended first: a stuck page stops here, before its replacement exists.
        end_current();
        let generation = GENERATION.get() + 1;
        GENERATION.set(generation);
        DISPLAY.set(Display::default());
        let built = handle
            .get_webview_window(MAIN_WINDOW)
            .ok_or(())
            .and_then(|window| {
                wry::WebViewBuilder::new()
                    .with_incognito(true)
                    .with_visible(false)
                    .with_on_page_load_handler(move |event, _url| {
                        if matches!(event, wry::PageLoadEvent::Finished) {
                            mark_loaded(generation);
                        }
                    })
                    .with_bounds(rect(bounds))
                    .with_custom_protocol(SCHEME.to_string(), move |_id, request| {
                        respond(
                            &store,
                            request.method().as_str(),
                            &request.uri().to_string(),
                        )
                        .map(Cow::from)
                    })
                    .with_navigation_handler(|url| is_allowed_navigation(&url))
                    .with_url(url)
                    .build_as_child(&window)
                    .map_err(|_| ())
            });
        let shown = built.map(|view| VIEW.with(|slot| *slot.borrow_mut() = Some((view, page))));
        if shown.is_ok() {
            let later = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY_AFTER);
                let _ = later.run_on_main_thread(move || mark_loaded(generation));
            });
        }
        let _ = sent.send(shown);
    })
    .map_err(|_| COULD_NOT_SHOW.to_string())?;
    received
        .recv()
        .map_err(|_| ())
        .and_then(|shown| shown)
        .map_err(|()| COULD_NOT_SHOW.to_string())
}

fn with_view(app: &AppHandle, act: impl FnOnce(&wry::WebView) + Send + 'static) {
    let _ = app.run_on_main_thread(move || {
        VIEW.with(|view| {
            if let Some((view, _)) = view.borrow().as_ref() {
                act(view);
            }
        });
    });
}

pub fn set_bounds(app: &AppHandle, bounds: Bounds) {
    with_view(app, move |view| {
        let _ = view.set_bounds(rect(bounds));
    });
}

/// Hides the page while something of Zorvo's must draw where it is: a native
/// webview is above the main webview's HTML.
pub fn set_hidden(app: &AppHandle, hidden: bool) {
    let _ = app.run_on_main_thread(move || {
        update_display(|display| Display {
            is_hidden: hidden,
            ..display
        });
    });
}

pub fn close(app: &AppHandle) {
    let _ = app.run_on_main_thread(end_current);
}

/// Closes the view only when it shows a page of `session_id` (and of
/// `artifact_id` when one is named): what is deleted must not stay on screen,
/// and nothing else may be taken off it.
pub fn close_for(app: &AppHandle, session_id: String, artifact_id: Option<String>) {
    let _ = app.run_on_main_thread(move || {
        let is_shown = VIEW.with(|slot| {
            is_showing(
                slot.borrow().as_ref().map(|(_, page)| page),
                &session_id,
                artifact_id.as_deref(),
            )
        });
        if is_shown {
            end_current();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn bounds_inside_the_window_are_kept() {
        let inside = bounds(800.0, 100.0, 560.0, 700.0);

        assert_eq!(checked_bounds(inside, 1440.0, 900.0), Some(inside));
    }

    #[test]
    fn bounds_must_be_finite_and_positive() {
        for bad in [
            bounds(f64::NAN, 0.0, 10.0, 10.0),
            bounds(0.0, f64::INFINITY, 10.0, 10.0),
            bounds(0.0, 0.0, f64::NAN, 10.0),
            bounds(0.0, 0.0, 10.0, f64::NEG_INFINITY),
            bounds(0.0, 0.0, 0.0, 10.0),
            bounds(0.0, 0.0, 10.0, -5.0),
        ] {
            assert_eq!(checked_bounds(bad, 1440.0, 900.0), None, "{bad:?}");
        }
        assert_eq!(
            checked_bounds(bounds(0.0, 0.0, 10.0, 10.0), f64::NAN, 900.0),
            None
        );
    }

    #[test]
    fn bounds_are_clipped_to_the_window() {
        let over = bounds(-20.0, 850.0, 200.0, 100.0);

        assert_eq!(
            checked_bounds(over, 1440.0, 900.0),
            Some(bounds(0.0, 850.0, 180.0, 50.0))
        );
    }

    #[test]
    fn bounds_outside_the_window_are_refused() {
        assert_eq!(
            checked_bounds(bounds(1500.0, 0.0, 100.0, 100.0), 1440.0, 900.0),
            None
        );
        assert_eq!(
            checked_bounds(bounds(0.0, -300.0, 100.0, 100.0), 1440.0, 900.0),
            None
        );
    }

    #[test]
    fn a_view_is_closed_only_for_what_it_shows() {
        let page = ShownPage {
            session_id: "s-1".to_string(),
            artifact_id: "a-0123456789abcdef".to_string(),
        };

        // Deleting the session it belongs to, or the artifact it shows, closes it.
        assert!(is_showing(Some(&page), "s-1", None));
        assert!(is_showing(Some(&page), "s-1", Some("a-0123456789abcdef")));
        // Deleting another session, or another artifact of the same session, does not.
        assert!(!is_showing(Some(&page), "s-2", None));
        assert!(!is_showing(Some(&page), "s-1", Some("a-ffffffffffffffff")));
        assert!(!is_showing(Some(&page), "s-2", Some("a-0123456789abcdef")));
        assert!(!is_showing(None, "s-1", None));
    }

    #[test]
    fn a_page_shows_once_it_has_loaded_and_nothing_covers_it() {
        // Made invisible, so a dark window never flashes the webview's white before the page paints.
        assert!(!is_visible(Display {
            is_loaded: false,
            is_hidden: false
        }));
        assert!(is_visible(Display {
            is_loaded: true,
            is_hidden: false
        }));
        assert!(!is_visible(Display {
            is_loaded: true,
            is_hidden: true
        }));
        assert!(!is_visible(Display {
            is_loaded: false,
            is_hidden: true
        }));
    }

    #[test]
    fn the_lockfile_holds_one_wry() {
        let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.lock"))
            .expect("read Cargo.lock");

        let count = lock.matches("\nname = \"wry\"\n").count();

        assert_eq!(count, 1, "wry must stay at the version Tauri uses");
    }
}
