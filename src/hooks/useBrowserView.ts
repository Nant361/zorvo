import { useEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLatest } from "./useLatest";

interface Bounds { x: number; y: number; width: number; height: number }
let queue: Promise<unknown> = Promise.resolve();

/** ResizeObserver only moves the retained native view; scrolling never crosses IPC. */
export function useBrowserView(boxRef: RefObject<HTMLElement | null>, sessionId: string, tabId: string | null, visible: boolean, onError: (message: string) => void): void {
  const latest = useLatest({ visible, onError });
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!tabId) return;
    let active = true;
    let frame = 0;
    const report = (error: unknown) => latest.current.onError(String(error));
    const sync = () => {
      const box = boxRef.current;
      if (!active || !box) return;
      const rect = box.getBoundingClientRect();
      const bounds: Bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const shown = latest.current.visible && bounds.width > 0 && bounds.height > 0;
      const key = JSON.stringify({ bounds, shown });
      if (key === last.current) return;
      last.current = key;
      queue = queue.catch(() => {}).then(() => active ? invoke("browser_bounds", { sessionId, tabId, bounds, visible: shown }) : undefined)
        .catch(error => active && latest.current.onError(String(error)));
    };
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(follow);
    if (boxRef.current) observer?.observe(boxRef.current);
    observer?.observe(document.body);
    window.addEventListener("resize", follow);
    follow();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", follow);
      last.current = null;
      queue = queue.catch(() => {}).then(() => invoke("browser_bounds", { sessionId, tabId, bounds: null, visible: false }))
        .catch(report);
    };
  }, [boxRef, sessionId, tabId, latest]);
  useEffect(() => {
    if (!tabId) return;
    if (!visible || !boxRef.current) {
      queue = queue.catch(() => {}).then(() => invoke("browser_bounds", { sessionId, tabId, bounds: null, visible: false }))
        .catch(error => latest.current.onError(String(error)));
      return;
    }
    const rect = boxRef.current.getBoundingClientRect();
    const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const shown = visible && bounds.width > 0 && bounds.height > 0;
    queue = queue.catch(() => {}).then(() => invoke("browser_bounds", { sessionId, tabId, bounds, visible: shown }))
      .catch(error => latest.current.onError(String(error)));
  }, [visible, boxRef, sessionId, tabId, latest]);
}
