//! WKUIDelegate replaces wry's permissive defaults. No page can request an OS grant.
use block2::{Block, RcBlock};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{Bool, NSObject},
    DefinedClass, MainThreadOnly,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSProcessInfo, NSString};
use objc2_web_kit::{
    WKFrameInfo, WKMediaCaptureType, WKNavigationAction, WKPermissionDecision, WKPreferences,
    WKScriptMessage, WKScriptMessageHandler, WKSecurityOrigin, WKUIDelegate,
    WKUserContentController, WKWebView, WKWebViewConfiguration, WKWindowFeatures,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;
static NEXT_FRAME: AtomicU64 = AtomicU64::new(1);
static NEXT_DIALOG: AtomicU64 = AtomicU64::new(1);

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {}

pub fn check_inherited_authorization() -> Result<(), String> {
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 12
    {
        return Err("The embedded browser requires macOS 12 or later.".into());
    }
    // A plain child can inherit a launcher's TCC identity. If just one device
    // is authorized, requesting the other can terminate an app without usage
    // strings before its denial delegate runs. Refuse this unsafe launch shape.
    let class = objc2::runtime::AnyClass::get(c"AVCaptureDevice")
        .ok_or("Capture authorization could not be checked.")?;
    unsafe {
        let video: isize =
            msg_send![class, authorizationStatusForMediaType: &*NSString::from_str("vide")];
        let audio: isize =
            msg_send![class, authorizationStatusForMediaType: &*NSString::from_str("soun")];
        if (video == 3) != (audio == 3) {
            return Err("Open Zorvo from Finder or with open -a Zorvo before using its embedded browser. This shell launch inherits an unsafe partial capture authorization.".into());
        }
    }
    Ok(())
}

pub fn disable_screen_capture(preferences: &WKPreferences) -> Result<(), String> {
    // SAFETY: private selectors are guarded and read back before any WKWebView exists.
    unsafe {
        let set: bool =
            msg_send![preferences,respondsToSelector:objc2::sel!(_setScreenCaptureEnabled:)];
        let get: bool =
            msg_send![preferences,respondsToSelector:objc2::sel!(_screenCaptureEnabled)];
        if !set || !get {
            return Err("This WebKit cannot disable page screen capture safely.".into());
        }
        let _: () = msg_send![preferences,_setScreenCaptureEnabled:false];
        let enabled: bool = msg_send![preferences, _screenCaptureEnabled];
        if enabled {
            return Err("WebKit did not disable screen capture.".into());
        }
    }
    Ok(())
}

enum Completion {
    Alert(RcBlock<dyn Fn()>),
    Confirm(RcBlock<dyn Fn(Bool)>),
    Prompt(RcBlock<dyn Fn(*mut NSString)>),
}
pub struct Dialog {
    pub info: Value,
    completion: Completion,
}
impl Dialog {
    pub fn answer(self, accept: bool, text: Option<&str>) {
        match self.completion {
            Completion::Alert(block) => block.call(()),
            Completion::Confirm(block) => block.call((Bool::new(accept),)),
            Completion::Prompt(block) => {
                let text = accept.then(|| NSString::from_str(text.unwrap_or("")));
                block.call((text
                    .as_ref()
                    .map_or(std::ptr::null_mut(), |s| Retained::as_ptr(s).cast_mut()),));
            }
        }
    }
    pub fn dismiss(self) {
        self.answer(false, None);
    }
}

pub struct DelegateData {
    app: AppHandle,
    session: String,
    tab: String,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind=MainThreadOnly]
    #[ivars=DelegateData]
    pub struct BrowserDelegate;

    unsafe impl NSObjectProtocol for BrowserDelegate {}

    unsafe impl WKScriptMessageHandler for BrowserDelegate {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn frame(&self,_controller:&WKUserContentController,message:&WKScriptMessage){
            // Only a fixed isolated-world handler reaches here, never a page-world IPC command.
            let frame=unsafe{message.frameInfo()};
            let sid=&self.ivars().session;let tid=&self.ivars().tab;
            super::with_tab(sid,tid,|tab|{
                if tab.frames.len()<100 && !tab.frames.iter().any(|(_,f)|std::ptr::eq(&**f,&*frame)){tab.frames.push((format!("frame_{}",NEXT_FRAME.fetch_add(1,Ordering::Relaxed)),frame));}
            });
        }
    }
    unsafe impl WKUIDelegate for BrowserDelegate {
        #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn popup(&self,_view:&WKWebView,_configuration:&WKWebViewConfiguration,action:&WKNavigationAction,_features:&WKWindowFeatures)->*mut WKWebView {
            let url=unsafe{action.request().URL().and_then(|u|u.absoluteString()).map(|s|s.to_string())};
            if let Some(url)=url.filter(|url|super::navigation_url(url).is_ok()) {
                let app=self.ivars().app.clone(); let session=self.ivars().session.clone();
                let app2=app.clone();
                let _=app.run_on_main_thread(move||{ if super::create(&app2,&session,&url).is_ok(){super::changed(&app2,&session);} });
            }
            std::ptr::null_mut()
        }
        #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
        fn media(&self,_view:&WKWebView,_origin:&WKSecurityOrigin,_frame:&WKFrameInfo,_kind:WKMediaCaptureType,decision:&Block<dyn Fn(WKPermissionDecision)>){decision.call((WKPermissionDecision::Deny,));}

        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn alert(&self,_view:&WKWebView,message:&NSString,frame:&WKFrameInfo,completion:&Block<dyn Fn()>){
            self.dialog("alert",message,None,frame,Completion::Alert(completion.copy()));
        }
        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn confirm(&self,_view:&WKWebView,message:&NSString,frame:&WKFrameInfo,completion:&Block<dyn Fn(Bool)>){
            self.dialog("confirm",message,None,frame,Completion::Confirm(completion.copy()));
        }
        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn prompt(&self,_view:&WKWebView,message:&NSString,default_text:Option<&NSString>,frame:&WKFrameInfo,completion:&Block<dyn Fn(*mut NSString)>){
            self.dialog("prompt",message,default_text,frame,Completion::Prompt(completion.copy()));
        }
    }
    impl BrowserDelegate {
        // The SDK-generated objc2 bindings predate this public macOS 27 callback.
        #[unsafe(method(webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:))]
        fn location(&self,_view:&WKWebView,_origin:&WKSecurityOrigin,_frame:&WKFrameInfo,decision:&Block<dyn Fn(WKPermissionDecision)>){decision.call((WKPermissionDecision::Deny,));}
    }
);

impl BrowserDelegate {
    pub fn new(
        mtm: MainThreadMarker,
        app: AppHandle,
        session: String,
        tab: String,
    ) -> Retained<Self> {
        let object = mtm
            .alloc::<Self>()
            .set_ivars(DelegateData { app, session, tab });
        unsafe { msg_send![super(object), init] }
    }
    fn dialog(
        &self,
        kind: &str,
        message: &NSString,
        default: Option<&NSString>,
        frame: &WKFrameInfo,
        completion: Completion,
    ) {
        let id = NEXT_DIALOG.fetch_add(1, Ordering::Relaxed);
        let info = unsafe {
            json!({"id":id,"type":kind,"message":message.to_string().chars().take(4000).collect::<String>(),"defaultText":default.map(|s|s.to_string()),"url":frame.request().URL().and_then(|u|u.absoluteString()).map(|s|s.to_string())})
        };
        let dialog = Dialog { info, completion };
        let sid = &self.ivars().session;
        let tid = &self.ivars().tab;
        super::with_tab(sid, tid, |tab| {
            if let Some(old) = tab.dialog.replace(dialog) {
                old.dismiss();
            }
        });
        super::changed(&self.ivars().app, sid);
        let app = self.ivars().app.clone();
        let sid = sid.clone();
        let tid = tid.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                super::with_tab(&sid, &tid, |tab| {
                    if tab
                        .dialog
                        .as_ref()
                        .and_then(|d| d.info.get("id"))
                        .and_then(Value::as_u64)
                        == Some(id)
                    {
                        if let Some(d) = tab.dialog.take() {
                            d.dismiss();
                        }
                    }
                });
                super::changed(&handle, &sid);
            });
        });
    }
}
