import { useRef, useState } from "react";
import { ArrowLeft, Globe } from "lucide-react";
import { useBrowser } from "../../hooks/useBrowser";
import { useBrowserView } from "../../hooks/useBrowserView";
import { useBoxCovered } from "../../hooks/useArtifactView";
import { useBrowserPicker } from "../../hooks/useBrowserPicker";
import { browserAddress, type BrowserEngine } from "../../lib/browser";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { BrowserTools } from "./BrowserTools";
import { BrowserToolbar, BROWSER_PANELS, type BrowserPanelId, type BrowserOverlay } from "./BrowserToolbar";
import { invoke } from "@tauri-apps/api/core";

export function BrowserPanel({ sessionId, onError, onAddContext }: { sessionId: string; onError: (message: string) => void; onAddContext?: (text: string) => void }) {
  const [engine, setEngine] = useState<BrowserEngine>("webkit");
  const [panel, setPanel] = useState<BrowserPanelId>("page");
  const [overlay, setOverlay] = useState<BrowserOverlay>(null);
  const browser = useBrowser(sessionId, engine);
  const active = browser.state.tabs.find(tab => tab.id === browser.state.activeTabId);
  const picker = useBrowserPicker({ sessionId, tab: engine === "webkit" && panel === "page" ? active : undefined, onAddContext, onError });
  const boxRef = useRef<HTMLDivElement>(null);
  const covered = useBoxCovered(boxRef, engine === "webkit" && panel === "page" && Boolean(active));
  useBrowserView(boxRef, sessionId, engine === "webkit" ? active?.id ?? null : null, panel === "page" && !covered && !overlay && !browser.state.dialog, onError);
  const [localError, setLocalError] = useState<string | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const run = (args: Record<string, unknown>) => {
    setLocalError(null);
    void browser.execute(args).catch(() => {});
  };
  const navigate = (input: string) => {
    try {
      const url = browserAddress(input);
      setPanel("page");
      run(active ? { operation: "navigate", tabId: active.id, url } : { operation: "tabs.open", url });
    } catch (error) { setLocalError(String(error)); }
  };
  const currentPanel = BROWSER_PANELS.find(item => item.id === panel)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Browser">
      <BrowserToolbar tabs={browser.state.tabs} active={active} engine={engine} panel={panel} busy={browser.busy}
        overlay={overlay} onOverlay={setOverlay} onNavigate={navigate} onAction={run}
        onEngine={next => { setEngine(next); setPanel("page"); }} onPanel={setPanel}
        onSelectElement={engine === "webkit" && panel === "page" && active && onAddContext ? picker.toggle : undefined} selectingElement={picker.active}
        onRevoke={() => {
          void invoke("browser_permission", { sessionId, allow: false }).then(() => window.dispatchEvent(new CustomEvent("zorvo:browser-revoked", { detail: { sessionId } }))).catch(error => onError(String(error)));
        }} />
      {panel !== "page" && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1">
        <IconButton label="Back to page" size="sm" onClick={() => setPanel("page")}><ArrowLeft size={14} /></IconButton>
        <h3 className="text-ui-sm text-fg-secondary">{currentPanel.label}</h3>
      </div>}
      {(localError || browser.error) && <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-ui-sm text-danger">{localError || browser.error}</p>}
      {browser.state.dialog && (
        <div role="group" aria-label="Page dialog" className="m-2 space-y-2 rounded-lg border border-attention-border bg-attention-surface p-3">
          <p className="truncate font-mono text-caption text-fg-muted">{browser.state.dialog.url}</p>
          <p className="whitespace-pre-wrap text-ui-sm text-fg">{browser.state.dialog.message}</p>
          {browser.state.dialog.type === "prompt" && <input ref={promptRef} key={`${browser.state.dialog.url}/${browser.state.dialog.message}`} aria-label="Page prompt reply" defaultValue={browser.state.dialog.defaultText ?? ""} className="h-8 w-full rounded-lg border border-border-strong bg-surface-2 px-2 text-ui-sm text-fg focus-ring" />}
          <div className="flex gap-2">
            <Button onClick={() => run({ operation: "dialog", tabId: active?.id, accept: true, text: promptRef.current?.value ?? browser.state.dialog?.defaultText ?? "" })}>Accept</Button>
            {browser.state.dialog.type !== "alert" && <Button variant="ghost" onClick={() => run({ operation: "dialog", tabId: active?.id, accept: false })}>Dismiss</Button>}
          </div>
        </div>
      )}
      <div role="region" aria-label={currentPanel.label === "Page" ? "Browser page" : currentPanel.label} className="flex min-h-0 flex-1 flex-col">
          <div ref={boxRef} className={`relative min-h-0 flex-1 ${panel === "page" ? "" : "hidden"}`} data-browser-box="">
            {!active ? <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-ui-sm text-fg-muted"><Globe size={24} /><p>Enter an address or search to open a page.</p></div> : engine === "chromium" ? <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-ui-sm text-fg-muted"><Globe size={24} /><p>Chromium debugging uses a separate browser window.</p><Button onClick={() => run({ operation: "tabs.focus", tabId: active.id })}>Show browser</Button></div> : null}
          </div>
        {panel !== "page" && <BrowserTools key={`${sessionId}/${engine}/${panel}`} panel={panel} sessionId={sessionId} engine={engine} tabId={active?.id} execute={browser.execute} />}
      </div>
    </div>
  );
}
