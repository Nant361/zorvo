//! Debug-only exercise of the real native views using a synthetic loopback page.
use super::{browser_bounds, execute, Bounds};
use serde_json::{json, Value};
use tauri::AppHandle;

pub async fn smoke(app: &AppHandle) -> Result<Value, String> {
    let url = std::env::var("ZORVO_BROWSER_SMOKE_URL").map_err(|_| "Smoke URL is missing.")?;
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid smoke URL.")?;
    if parsed.scheme() != "http" || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("Smoke testing requires a loopback HTTP fixture.".into());
    }
    let a = "native-browser-smoke-a".to_string();
    let b = "native-browser-smoke-b".to_string();
    let mut steps = vec![];
    let result=async{
        execute(app,a.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,a.clone(),json!({"operation":"wait","selector":"#increment"})).await?;
        let state=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?;
        let tid=state["activeTabId"].as_str().ok_or("No native active tab.")?.to_string();
        browser_bounds(app.clone(),a.clone(),Some(tid.clone()),Some(Bounds{x:20.,y:100.,width:800.,height:600.}),true).await?;
        let snapshot=execute(app,a.clone(),json!({"operation":"snapshot"})).await?;
        let button=snapshot["controls"].as_array().and_then(|rows|rows.iter().find(|r|r["name"]=="Increment")).and_then(|r|r["ref"].as_str()).ok_or("Snapshot did not name the button.")?.to_owned();
        steps.push(json!({"name":"native view and isolated snapshot","pass":true}));
        execute(app,a.clone(),json!({"operation":"fill","selector":"#input","value":"changed"})).await?;
        execute(app,a.clone(),json!({"operation":"click","ref":button})).await?;
        execute(app,a.clone(),json!({"operation":"select","selector":"#choice","value":"b"})).await?;
        execute(app,a.clone(),json!({"operation":"check","selector":"#check","checked":true})).await?;
        let values=execute(app,a.clone(),json!({"operation":"evaluate","expression":"({input:document.querySelector('#input').value,count:document.querySelector('#count').textContent,choice:document.querySelector('#choice').value,checked:document.querySelector('#check').checked,inputEvents:document.body.dataset.inputEvents,bridge:typeof window.__TAURI_INTERNALS__,isolated:typeof window.__zorvoBrowser})"})).await?;
        if values["input"]!="changed"||values["count"]!="1"||values["choice"]!="b"||values["checked"]!=true||values["bridge"]!="undefined"||values["isolated"]!="undefined"{return Err(format!("Native form/isolation failed: {values}"));}
        steps.push(json!({"name":"ref click, controlled input, select, check, no app bridge","pass":true,"values":values}));
        let screenshot=execute(app,a.clone(),json!({"operation":"screenshot"})).await?;
        if screenshot["base64"].as_str().is_none_or(|s|s.len()<100){return Err("Native screenshot was empty.".into());}
        steps.push(json!({"name":"native PNG screenshot","pass":true,"base64Length":screenshot["base64"].as_str().map(str::len)}));
        browser_bounds(app.clone(),a.clone(),Some(tid),None,false).await?;
        let start=std::time::Instant::now();
        execute(app,a.clone(),json!({"operation":"click","ref":button})).await?;
        let hidden=execute(app,a.clone(),json!({"operation":"evaluate","expression":"({hidden:document.hidden,count:document.querySelector('#count').textContent})"})).await?;
        execute(app,a.clone(),json!({"operation":"screenshot"})).await?;
        if hidden["hidden"]!=true||hidden["count"]!="2"{return Err(format!("Hidden native interaction failed: {hidden}"));}
        steps.push(json!({"name":"hidden view click/state/native snapshot","pass":true,"elapsedMs":start.elapsed().as_millis(),"values":hidden}));
        let frames=execute(app,a.clone(),json!({"operation":"frames"})).await?;
        if frames["frames"].as_array().is_none_or(|rows|rows.len()<3){return Err(format!("Frame identities missing: {frames}"));}
        for frame in frames["frames"].as_array().expect("frames checked"){
            let data=execute(app,a.clone(),json!({"operation":"snapshot","frameId":frame["id"]})).await?;
            if data["title"]!="Browser smoke" {return Err("A frame snapshot failed.".into());}
        }
        steps.push(json!({"name":"same- and cross-origin frame snapshots","pass":true,"frames":frames}));
        execute(app,a.clone(),json!({"operation":"evaluate","expression":"document.cookie='native_smoke=alpha; SameSite=Lax'; document.cookie"})).await?;
        execute(app,a.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,a.clone(),json!({"operation":"wait","selector":"#input"})).await?;
        let shared=execute(app,a.clone(),json!({"operation":"evaluate","expression":"document.cookie"})).await?;
        execute(app,b.clone(),json!({"operation":"tabs.open","url":url})).await?;
        execute(app,b.clone(),json!({"operation":"wait","selector":"#input"})).await?;
        let separate=execute(app,b.clone(),json!({"operation":"evaluate","expression":"document.cookie"})).await?;
        if !shared.as_str().is_some_and(|s|s.contains("native_smoke=alpha"))||separate.as_str().is_some_and(|s|s.contains("native_smoke=alpha")){return Err("Session cookie isolation failed.".into());}
        steps.push(json!({"name":"shared store within session, separate store across sessions","pass":true}));
        execute(app,a.clone(),json!({"operation":"navigate","url":url})).await?;
        execute(app,a.clone(),json!({"operation":"wait","selector":"#input"})).await?;
        if execute(app,a.clone(),json!({"operation":"click","ref":button})).await.is_ok(){return Err("A stale reference was accepted.".into());}
        steps.push(json!({"name":"stale cross-tab/document reference rejected","pass":true}));
        let dialog_eval = {
            let app=app.clone(); let session=a.clone();
            tauri::async_runtime::spawn(async move { execute(&app,session,json!({"operation":"evaluate","expression":"(globalThis.smokeDialog=confirm('Browser smoke confirm'))"})).await })
        };
        let mut dialog=Value::Null;
        for _ in 0..30 {
            dialog=execute(app,a.clone(),json!({"operation":"dialog","action":"inspect"})).await?;
            if !dialog["dialog"].is_null(){break;}
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        if dialog["dialog"].is_null(){return Err("Native confirm did not reach the dialog delegate.".into());}
        let inspected=execute(app,a.clone(),json!({"operation":"dialog","action":"inspect"})).await?;
        if inspected["dialog"]["id"]!=dialog["dialog"]["id"] {return Err("Inspect consumed a native dialog.".into());}
        execute(app,a.clone(),json!({"operation":"dialog","action":"accept"})).await?;
        dialog_eval.await.map_err(|e|e.to_string())??;
        if execute(app,a.clone(),json!({"operation":"evaluate","expression":"globalThis.smokeDialog"})).await?!=true {return Err("Native dialog accept did not return true.".into());}
        steps.push(json!({"name":"dialog inspection does not consume and accept returns true","pass":true}));
        let before=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?["tabs"].as_array().map(Vec::len).unwrap_or(0);
        execute(app,a.clone(),json!({"operation":"evaluate","expression":"(window.open(location.href),true)"})).await?;
        let mut after=before;
        for _ in 0..30 {
            after=execute(app,a.clone(),json!({"operation":"tabs.list"})).await?["tabs"].as_array().map(Vec::len).unwrap_or(0);
            if after>before {break;}
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        if after!=before+1 {return Err("Native window.open did not create a session tab.".into());}
        steps.push(json!({"name":"window.open creates a tab in the same session","pass":true}));
        Ok::<_,String>(())
    }.await;
    super::close_session(app, a);
    super::close_session(app, b);
    if let Err(error) = result {
        return Ok(json!({"status":"fail","steps":steps,"error":error}));
    }
    Ok(json!({"status":"pass","steps":steps}))
}
