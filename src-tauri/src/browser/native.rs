//! All retained Objective-C objects and wry views stay on the main thread.
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyObject, MainThreadOnly};
use objc2_foundation::{
    MainThreadMarker, NSDictionary, NSError, NSJSONSerialization, NSJSONWritingOptions, NSString,
};
use objc2_web_kit::{
    WKContentWorld, WKFrameInfo, WKUserScript, WKUserScriptInjectionTime, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use wry::{WebViewBuilderExtMacos, WebViewExtMacOS};

use super::{navigation_url, Bounds};
#[path = "policy.rs"]
mod policy;

const PAGE: &str = include_str!("page.js");
const CONSOLE: &str = include_str!("console.js");
const WORLD: &str = "xyz.zorvo.browser.operations";
const MAX_TABS: usize = 12;
const MAX_SESSIONS: usize = 8;
const RESULT_LIMIT: usize = 2 * 1024 * 1024;
type Reply = oneshot::Sender<Result<Value, String>>;

pub(super) struct Tab {
    view: wry::WebView,
    _delegate: Retained<policy::BrowserDelegate>,
    frames: Vec<(String, Retained<WKFrameInfo>)>,
    loading: bool,
    initial_url: String,
    dialog: Option<policy::Dialog>,
}
struct Session {
    store: Retained<WKWebsiteDataStore>,
    tabs: Vec<(String, Tab)>,
    active: Option<String>,
}
thread_local! {
    static SESSIONS: RefCell<HashMap<String,Session>> = RefCell::new(HashMap::new());
}

pub(super) fn with_tab<R>(
    session: &str,
    tab: &str,
    apply: impl FnOnce(&mut Tab) -> R,
) -> Option<R> {
    SESSIONS.with(|sessions| {
        sessions
            .borrow_mut()
            .get_mut(session)?
            .tabs
            .iter_mut()
            .find(|(id, _)| id == tab)
            .map(|(_, tab)| apply(tab))
    })
}

fn metadata(id: &str, tab: &Tab) -> Value {
    let view = tab.view.webview();
    // SAFETY: called only on the main thread for a retained WKWebView.
    unsafe {
        json!({"id":id,"engine":"WebKit","url":view.URL().and_then(|u|u.absoluteString()).map(|s|s.to_string()).unwrap_or_else(||tab.initial_url.clone()),
        "title":view.title().map(|v|v.to_string()).unwrap_or_else(||"New tab".into()),"loading":tab.loading,
        "canGoBack":view.canGoBack(),"canGoForward":view.canGoForward()})
    }
}
fn state(session_id: &str) -> Value {
    SESSIONS.with(|sessions| {
        let sessions=sessions.borrow();
        if let Some(session)=sessions.get(session_id) {
            let dialog=session.active.as_ref().and_then(|id|session.tabs.iter().find(|(tid,_)|tid==id)).and_then(|(_,tab)|tab.dialog.as_ref()).map(|d|d.info.clone());
            json!({"sessionId":session_id,"tabs":session.tabs.iter().map(|(id,t)|metadata(id,t)).collect::<Vec<_>>(),"activeTabId":session.active,"dialog":dialog})
        } else { json!({"sessionId":session_id,"tabs":[],"activeTabId":null}) }
    })
}
pub(super) fn changed(app: &AppHandle, session: &str) {
    let _ = app.emit("browser-state-changed", state(session));
}

fn world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
    // SAFETY: named worlds separate script globals and are created on main.
    unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) }
}

fn create(app: &AppHandle, sid: &str, url: &str) -> Result<String, String> {
    let mtm = MainThreadMarker::new().ok_or("Browser view must be created on the main thread.")?;
    policy::check_inherited_authorization()?;
    let window = app
        .get_webview_window("main")
        .ok_or("The main window is unavailable.")?;
    let id = format!("tab_{}", NEXT.fetch_add(1, Ordering::Relaxed));
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        if !sessions.contains_key(sid) && sessions.len() >= MAX_SESSIONS {
            return Err("Close a browser session before opening another.".into());
        }
        let session = sessions.entry(sid.into()).or_insert_with(|| Session {
            // SAFETY: each app session owns one non-persistent store; per-tab configurations are separate.
            store: unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) },
            tabs: vec![],
            active: None,
        });
        if session.tabs.len() >= MAX_TABS {
            return Err("This session has reached its browser tab limit.".into());
        }
        // SAFETY: configuration, preferences, content controller and scripts are retained native objects on main.
        let config = unsafe { WKWebViewConfiguration::new(mtm) };
        let delegate = policy::BrowserDelegate::new(mtm, app.clone(), sid.into(), id.clone());
        unsafe {
            config.setWebsiteDataStore(&session.store);
            config
                .preferences()
                .setJavaScriptCanOpenWindowsAutomatically(true);
            policy::disable_screen_capture(&config.preferences())?;
            let controller = config.userContentController();
            controller.addScriptMessageHandler_contentWorld_name(
                objc2::runtime::ProtocolObject::from_ref(&*delegate),
                &world(mtm),
                &NSString::from_str("zorvoBrowserFrame"),
            );
            let isolated =
                WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                    WKUserScript::alloc(mtm),
                    &NSString::from_str(PAGE),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    false,
                    &world(mtm),
                );
            controller.addUserScript(&isolated);
            let console = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                WKUserScript::alloc(mtm),
                &NSString::from_str(CONSOLE),
                WKUserScriptInjectionTime::AtDocumentStart,
                false,
            );
            controller.addUserScript(&console);
        }
        let loaded_app = app.clone();
        let loaded_sid = sid.to_string();
        let loaded_id = id.clone();
        let popup_app = app.clone();
        let popup_sid = sid.to_string();
        let view = wry::WebViewBuilder::new()
            .with_webview_configuration(config)
            .with_visible(false)
            .with_bounds(rect(Bounds {
                x: 0.,
                y: 0.,
                width: 800.,
                height: 600.,
            }))
            .with_navigation_handler(|raw| navigation_url(&raw).is_ok())
            .with_new_window_req_handler(move |raw, _| {
                if navigation_url(&raw).is_ok() {
                    let app = popup_app.clone();
                    let session = popup_sid.clone();
                    let _ = popup_app.run_on_main_thread(move || {
                        if create(&app, &session, &raw).is_ok() {
                            changed(&app, &session);
                        }
                    });
                }
                wry::NewWindowResponse::Deny
            })
            .with_permission_handler(|_| wry::PermissionResponse::Deny)
            .with_download_started_handler(|_, _| false)
            .with_on_page_load_handler(move |event, _| {
                let app = loaded_app.clone();
                let sid = loaded_sid.clone();
                let tid = loaded_id.clone();
                let _ = loaded_app.run_on_main_thread(move || {
                    with_tab(&sid, &tid, |tab| {
                        tab.loading = matches!(event, wry::PageLoadEvent::Started);
                        if tab.loading {
                            tab.frames.clear();
                            if let Some(d) = tab.dialog.take() {
                                d.dismiss();
                            }
                        }
                    });
                    changed(&app, &sid);
                });
            })
            .build_as_child(&window)
            .map_err(|e| format!("Could not create the browser view: {e}"))?;
        unsafe {
            view.webview()
                .setUIDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*delegate)));
        }
        // First untrusted load starts only after capture denial and the isolated
        // data handler are installed. wry's default delegate never sees a page.
        view.load_url(url)
            .map_err(|e| format!("Could not load the browser page: {e}"))?;
        // No app initialization script or invoke key exists in this view. Only our isolated data handler is installed.
        for (_, tab) in &session.tabs {
            let _ = tab.view.set_visible(false);
        }
        session.tabs.push((
            id.clone(),
            Tab {
                view,
                _delegate: delegate,
                frames: vec![],
                loading: true,
                initial_url: url.into(),
                dialog: None,
            },
        ));
        session.active = Some(id.clone());
        Ok(id)
    })
}
static NEXT: AtomicU64 = AtomicU64::new(1);
fn rect(b: Bounds) -> wry::Rect {
    wry::Rect {
        position: wry::dpi::LogicalPosition::new(b.x, b.y).into(),
        size: wry::dpi::LogicalSize::new(b.width, b.height).into(),
    }
}

fn end(mut tab: Tab) {
    if let Some(dialog) = tab.dialog.take() {
        dialog.dismiss();
    }
    let view = tab.view.webview();
    // SAFETY: checked private termination selector is the same process-lifetime policy as artifact views.
    unsafe {
        view.stopLoading();
        let controller = view.configuration().userContentController();
        let mtm = MainThreadMarker::new().expect("browser close on main");
        controller.removeScriptMessageHandlerForName_contentWorld(
            &NSString::from_str("zorvoBrowserFrame"),
            &world(mtm),
        );
        view.setUIDelegate(None);
        let responds: bool =
            msg_send![&*view,respondsToSelector:objc2::sel!(_killWebContentProcess)];
        if responds {
            let _: () = msg_send![&*view, _killWebContentProcess];
        }
    }
    drop(tab);
}

pub async fn execute(app: &AppHandle, sid: String, args: Value) -> Result<Value, String> {
    let (send, receive) = oneshot::channel();
    let handle = app.clone();
    let timeout = args
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(10000)
        .clamp(100, 30000)
        + 2000;
    app.run_on_main_thread(move || dispatch(&handle, &sid, args, send))
        .map_err(|_| "The browser main thread is unavailable.")?;
    tokio::time::timeout(Duration::from_millis(timeout), receive)
        .await
        .map_err(|_| "The browser operation timed out.")?
        .map_err(|_| "The browser operation was cancelled.")?
}

fn dispatch(app: &AppHandle, sid: &str, args: Value, reply: Reply) {
    if reply.is_closed() {
        return;
    }
    if let Err(error) = crate::browser_commands::check_authorization(app, sid, &args) {
        let _ = reply.send(Err(error));
        return;
    }
    let operation = args.get("operation").and_then(Value::as_str).unwrap_or("");
    if operation == "tabs.list" {
        let _ = reply.send(Ok(state(sid)));
        return;
    }
    if operation == "tabs.open" {
        let answer = args
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Provide a URL.".into())
            .and_then(navigation_url)
            .and_then(|url| create(app, sid, &url));
        if answer.is_ok() {
            changed(app, sid);
        }
        let _ = reply.send(answer.map(|id| json!({"tabId":id,"state":state(sid)})));
        return;
    }
    let tid = args
        .get("tabId")
        .or_else(|| args.get("tabID"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| SESSIONS.with(|s| s.borrow().get(sid).and_then(|s| s.active.clone())));
    let Some(tid) = tid else {
        let _ = reply.send(Err("Open a browser tab first.".into()));
        return;
    };
    if operation == "tabs.close" {
        let result = SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let session = sessions
                .get_mut(sid)
                .ok_or("The browser session is closed.")?;
            let index = session
                .tabs
                .iter()
                .position(|(id, _)| id == &tid)
                .ok_or("The browser tab is closed.")?;
            let (_, tab) = session.tabs.remove(index);
            end(tab);
            if session.active.as_deref() == Some(&tid) {
                session.active = session.tabs.first().map(|(id, _)| id.clone());
            }
            if session.tabs.is_empty() {
                sessions.remove(sid);
            }
            Ok(())
        });
        changed(app, sid);
        let _ = reply.send(result.map(|_| state(sid)));
        return;
    }
    if operation == "tabs.focus" {
        let result = SESSIONS.with(|sessions| {
            let mut sessions = sessions.borrow_mut();
            let s = sessions
                .get_mut(sid)
                .ok_or("The browser session is closed.")?;
            if !s.tabs.iter().any(|(id, _)| id == &tid) {
                return Err("The browser tab is closed.");
            }
            s.active = Some(tid.clone());
            for (_, t) in &s.tabs {
                let _ = t.view.set_visible(false);
            }
            Ok(())
        });
        changed(app, sid);
        let _ = reply.send(result.map(|_| state(sid)).map_err(str::to_string));
        return;
    }
    let mut reply = Some(reply);
    let found = with_tab(sid, &tid, |tab| {
        let reply = reply.take().expect("one native operation");
        match operation {
            "navigate" => {
                let result = args
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Provide a URL.".into())
                    .and_then(navigation_url)
                    .and_then(|u| tab.view.load_url(&u).map_err(|e| e.to_string()))
                    .map(|_| json!({"navigating":true}));
                let _ = reply.send(result);
            }
            "back" | "forward" | "reload" | "stop" => {
                unsafe {
                    let v = tab.view.webview();
                    match operation {
                        "back" => {
                            v.goBack();
                        }
                        "forward" => {
                            v.goForward();
                        }
                        "reload" => {
                            v.reload();
                        }
                        _ => v.stopLoading(),
                    }
                }
                let _ = reply.send(Ok(json!({"accepted":true})));
            }
            "frames" => {
                let values=tab.frames.iter().map(|(id,f)|unsafe{json!({"id":id,"isMainFrame":f.isMainFrame(),"url":f.request().URL().and_then(|u|u.absoluteString()).map(|s|s.to_string())})}).collect::<Vec<_>>();
                let _ = reply.send(Ok(json!({"frames":values})));
            }
            "dialog" => {
                let action = args.get("action").and_then(Value::as_str).unwrap_or(
                    if args.get("accept").is_some() {
                        "answer"
                    } else {
                        "inspect"
                    },
                );
                if action == "inspect" {
                    let _ = reply.send(Ok(
                        json!({"dialog":tab.dialog.as_ref().map(|d|d.info.clone())}),
                    ));
                    return;
                }
                if !matches!(action, "accept" | "dismiss" | "answer") {
                    let _ = reply.send(Err(
                        "Dialog action must be inspect, accept or dismiss.".into()
                    ));
                    return;
                }
                if let Some(dialog) = tab.dialog.take() {
                    dialog.answer(
                        action == "accept"
                            || (action == "answer"
                                && args.get("accept").and_then(Value::as_bool).unwrap_or(false)),
                        args.get("text").and_then(Value::as_str),
                    );
                    let _ = reply.send(Ok(json!({"answered":true})));
                } else {
                    let _ = reply.send(Err("There is no pending page dialog.".into()));
                }
            }
            "screenshot" => screenshot(&tab.view.webview(), reply),
            "evaluate" | "console" => {
                let code = if operation == "console" {
                    "JSON.stringify({pageControlled:true,lines:globalThis.__zorvoConsole||[]})"
                        .to_owned()
                } else {
                    args.get("expression")
                        .or_else(|| args.get("script"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned()
                };
                if code.len() > 100000 {
                    let _ = reply.send(Err("The expression is too large.".into()));
                    return;
                }
                evaluate(
                    &tab.view.webview(),
                    &code,
                    args.get("frameId"),
                    &tab.frames,
                    reply,
                    operation == "console",
                );
            }
            "snapshot" | "find" | "wait" | "click" | "hover" | "drag" | "fill" | "fill_form"
            | "select" | "check" | "press" | "scroll" => {
                helper(
                    &tab.view.webview(),
                    args.get("frameId"),
                    &tab.frames,
                    &args,
                    reply,
                );
            }
            _ => {
                let _ = reply.send(Err(
                    "This operation requires the Chromium debug engine. Set engine to chromium."
                        .into(),
                ));
            }
        }
    });
    if found.is_none() {
        if let Some(reply) = reply {
            let _ = reply.send(Err(
                "The browser tab is closed or belongs to another session.".into(),
            ));
        }
    }
    if matches!(
        operation,
        "dialog" | "navigate" | "back" | "forward" | "reload" | "stop"
    ) {
        changed(app, sid);
    }
}

fn frame<'a>(
    id: Option<&Value>,
    frames: &'a [(String, Retained<WKFrameInfo>)],
) -> Result<Option<&'a WKFrameInfo>, String> {
    let Some(id) = id.and_then(Value::as_str) else {
        return Ok(None);
    };
    frames
        .iter()
        .find(|(fid, _)| fid == id)
        .map(|(_, f)| Some(&**f))
        .ok_or_else(|| "The frame reference is stale. Read frames again.".into())
}
fn callback(
    reply: Reply,
    parse: bool,
    helper: bool,
) -> RcBlock<dyn Fn(*mut AnyObject, *mut NSError)> {
    let reply = Rc::new(RefCell::new(Some(reply)));
    RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        let Some(reply) = reply.borrow_mut().take() else {
            return;
        };
        let result = if !error.is_null() {
            Err("WebKit could not complete the script (navigation, page error or denied execution).".into())
        } else if value.is_null() {
            Ok(Value::Null)
        } else {
            // SAFETY: WebKit owns callback arguments for the callback's duration.
            let text = unsafe { (&*value).downcast_ref::<NSString>().map(|s| s.to_string()) };
            if let Some(text) = text {
                if text.len() > RESULT_LIMIT {
                    Err("The browser result exceeds 2 MiB.".into())
                } else if parse {
                    serde_json::from_str::<Value>(&text)
                        .map_err(|_| "WebKit returned invalid structured data.".to_string())
                        .and_then(|data| {
                            if helper {
                                if data.get("ok") == Some(&Value::Bool(true)) {
                                    Ok(data.get("value").cloned().unwrap_or(Value::Null))
                                } else {
                                    Err(data
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Browser helper failed.")
                                        .to_owned())
                                }
                            } else {
                                Ok(data)
                            }
                        })
                } else {
                    Ok(json!(text))
                }
            } else {
                unsafe {
                    NSJSONSerialization::dataWithJSONObject_options_error(
                        &*value,
                        NSJSONWritingOptions::FragmentsAllowed,
                    )
                }
                .map_err(|_| {
                    "The page returned a value that cannot be represented as JSON.".to_string()
                })
                .and_then(|data| {
                    if data.len() > RESULT_LIMIT {
                        Err("The browser result exceeds 2 MiB.".into())
                    } else {
                        serde_json::from_slice(&data.to_vec())
                            .map_err(|_| "WebKit returned invalid JSON.".to_string())
                    }
                })
            }
        };
        let _ = reply.send(result);
    })
}
fn helper(
    view: &WKWebView,
    id: Option<&Value>,
    frames: &[(String, Retained<WKFrameInfo>)],
    args: &Value,
    reply: Reply,
) {
    let selected = match frame(id, frames) {
        Ok(v) => v,
        Err(e) => {
            let _ = reply.send(Err(e));
            return;
        }
    };
    let mtm = MainThreadMarker::new().expect("browser helper main");
    let key = NSString::from_str("encoded");
    let data = NSString::from_str(&args.to_string());
    let arguments: Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[&*data]);
    let cb = callback(reply, true, true);
    // SAFETY: fixed helper body with typed JSON argument in a named world; never string interpolation.
    unsafe {
        view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str("return await globalThis.__zorvoBrowser.dispatch(encoded)"),
            Some(&arguments),
            selected,
            &world(mtm),
            Some(&cb),
        );
    }
}
fn evaluate(
    view: &WKWebView,
    source: &str,
    id: Option<&Value>,
    frames: &[(String, Retained<WKFrameInfo>)],
    reply: Reply,
    parse: bool,
) {
    let selected = match frame(id, frames) {
        Ok(v) => v,
        Err(e) => {
            let _ = reply.send(Err(e));
            return;
        }
    };
    let mtm = MainThreadMarker::new().expect("browser evaluate main");
    let cb = callback(reply, parse, false);
    let key = NSString::from_str("expression");
    let expression = NSString::from_str(source);
    let arguments: Retained<NSDictionary<NSString, AnyObject>> =
        NSDictionary::from_slices(&[&*key], &[&*expression]);
    // SAFETY: explicit evaluate runs caller code only in the page world. Typed arguments
    // never splice source into the isolated helper or a frame handler.
    unsafe {
        view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str("return await (0,eval)(expression)"),
            Some(&arguments),
            selected,
            &WKContentWorld::pageWorld(mtm),
            Some(&cb),
        );
    }
}
fn screenshot(view: &WKWebView, reply: Reply) {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    let reply = Rc::new(RefCell::new(Some(reply)));
    let cb = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let Some(reply) = reply.borrow_mut().take() else {
            return;
        };
        let result = (|| {
            if image.is_null() || !error.is_null() {
                return Err("WebKit could not capture this page.".into());
            }
            // SAFETY: callback image is valid for the callback; conversion stays on main.
            let png = unsafe {
                let data = (&*image)
                    .TIFFRepresentation()
                    .ok_or("The snapshot is empty.")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&data)
                    .ok_or("The snapshot could not be decoded.")?;
                bitmap
                    .representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                    .ok_or("The snapshot could not be encoded.")?
            };
            let bytes = png.to_vec();
            if bytes.len() > 5 * 1024 * 1024 {
                return Err("The screenshot exceeds 5 MiB.".into());
            }
            Ok(
                json!({"engine":"WebKit","mimeType":"image/png","base64":base64::engine::general_purpose::STANDARD.encode(bytes)}),
            )
        })();
        let _ = reply.send(result);
    });
    unsafe {
        view.takeSnapshotWithConfiguration_completionHandler(None, &cb);
    }
}

pub async fn bounds(
    app: &AppHandle,
    sid: String,
    tid: Option<String>,
    bounds: Option<Bounds>,
    visible: bool,
) -> Result<(), String> {
    if visible {
        crate::artifacts::view::set_hidden(app, true);
    }
    let handle = app.clone();
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let bounds = handle.get_webview_window("main").and_then(|window| {
            let scale = window.scale_factor().ok()?;
            let size = window.inner_size().ok()?.to_logical::<f64>(scale);
            bounds
                .and_then(|b| {
                    crate::artifacts::view::checked_bounds(
                        crate::artifacts::view::Bounds {
                            x: b.x,
                            y: b.y,
                            width: b.width,
                            height: b.height,
                        },
                        size.width,
                        size.height,
                    )
                })
                .map(|b| Bounds {
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                })
        });
        let result = SESSIONS.with(|sessions| {
            for (session_id, s) in sessions.borrow_mut().iter_mut() {
                for (id, tab) in &mut s.tabs {
                    let show = visible
                        && session_id == &sid
                        && Some(id.as_str()) == tid.as_deref()
                        && bounds.is_some();
                    if show {
                        tab.view
                            .set_bounds(rect(bounds.expect("checked bounds")))
                            .map_err(|e| e.to_string())?;
                    }
                    tab.view.set_visible(show).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        });
        let _ = send.send(result);
    })
    .map_err(|_| "The browser main thread is unavailable.")?;
    tokio::time::timeout(Duration::from_secs(5), receive)
        .await
        .map_err(|_| "Browser placement timed out.")?
        .map_err(|_| "Browser placement was cancelled.")?
}
pub fn close_session(app: &AppHandle, sid: String) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(s) = SESSIONS.with(|sessions| sessions.borrow_mut().remove(&sid)) {
            for (_, tab) in s.tabs {
                end(tab);
            }
        }
        changed(&app2, &sid);
    });
}
pub fn close_all(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        let sessions = SESSIONS.with(|sessions| std::mem::take(&mut *sessions.borrow_mut()));
        for (_, s) in sessions {
            for (_, tab) in s.tabs {
                end(tab);
            }
        }
    });
}
