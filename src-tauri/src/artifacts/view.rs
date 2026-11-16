//! The artifact page's own webview: a child of the main window, placed over
//! the box the main webview leaves for it.
//!
//! It is made with wry directly, so Tauri never sees it: no IPC script, no
//! invoke key and no message handler exist inside it. It has its own web
//! content process, so a page that never yields cannot stop Zorvo's interface
//! (a frame inside the main webview does; see the spec's spike results).
//! There is one at a time, and it lives on the main thread.

use std::borrow::Cow;
use std::cell::RefCell;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use super::protocol::{is_allowed_navigation, respond, SCHEME};
use super::store::ArtifactStore;

const MAIN_WINDOW: &str = "main";
pub const COULD_NOT_SHOW: &str = "Zorvo could not show that page.";

thread_local! {
    /// The one child webview. `wry::WebView` is not `Send`, so it stays here.
    static VIEW: RefCell<Option<wry::WebView>> = const { RefCell::new(None) };
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
    url: String,
    bounds: Bounds,
) -> Result<(), String> {
    let (sent, received) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        // Dropped first: a stuck page ends here, before its replacement exists.
        VIEW.with(|view| view.borrow_mut().take());
        let built = handle
            .get_webview_window(MAIN_WINDOW)
            .ok_or(())
            .and_then(|window| {
                wry::WebViewBuilder::new()
                    .with_incognito(true)
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
        let shown = built.map(|view| VIEW.with(|slot| *slot.borrow_mut() = Some(view)));
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
            if let Some(view) = view.borrow().as_ref() {
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
    with_view(app, move |view| {
        let _ = view.set_visible(!hidden);
    });
}

pub fn close(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        VIEW.with(|view| view.borrow_mut().take());
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
    fn the_lockfile_holds_one_wry() {
        let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.lock"))
            .expect("read Cargo.lock");

        let count = lock.matches("\nname = \"wry\"\n").count();

        assert_eq!(count, 1, "wry must stay at the version Tauri uses");
    }
}
