import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readBrowserState, type BrowserEngine, type BrowserSessionState } from "../lib/browser";

export function useBrowser(sessionId: string, engine: BrowserEngine) {
  const [state, setState] = useState<BrowserSessionState>({ sessionId, tabs: [], activeTabId: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refreshId = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const request = ++refreshId.current;
    const value = await invoke("browser_execute", { sessionId, args: { operation: "tabs.list", engine } });
    if (epoch !== generation.current || request !== refreshId.current) return;
    const next = readBrowserState(value, sessionId);
    if (next) setState(next);
  }, [sessionId, engine]);

  useEffect(() => {
    let active = true;
    const epoch = ++generation.current;
    setState({ sessionId, tabs: [], activeTabId: null });
    setError(null);
    setBusy(false);
    const unlisten = listen<unknown>("browser-state-changed", event => {
      if (!active || engine !== "webkit") return;
      const next = readBrowserState(event.payload, sessionId);
      if (next) {
        refreshId.current++;
        setState(next);
      }
    }).catch(reason => { if (active) setError(String(reason)); return () => {}; });
    // Subscribe before reading, so an open-tab event cannot be lost during mount.
    void unlisten.then(async () => { if (active) await refresh(); }).catch(reason => { if (active) setError(String(reason)); });
    return () => {
      active = false;
      generation.current = epoch + 1;
      void unlisten.then(stop => stop());
    };
  }, [sessionId, engine, refresh]);

  const execute = useCallback(async (args: Record<string, unknown>) => {
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke("browser_execute", { sessionId, args: { ...args, engine } });
      if (epoch !== generation.current) return null;
      await refresh();
      return result;
    } catch (reason) {
      if (epoch === generation.current) setError(String(reason));
      throw reason;
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }, [sessionId, engine, refresh]);

  return { state, error, busy, execute };
}
