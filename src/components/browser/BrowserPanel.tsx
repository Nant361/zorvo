import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Globe, MoreHorizontal, Plus, RotateCw, X } from "lucide-react";
import { useBrowser } from "../../hooks/useBrowser";
import { useBrowserView } from "../../hooks/useBrowserView";
import { useBoxCovered } from "../../hooks/useArtifactView";
import { browserAddress, type BrowserEngine, type BrowserTab } from "../../lib/browser";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Tabs, tabIds } from "../ui/Tabs";
import { BrowserTools } from "./BrowserTools";
import { Popover, PopoverOption } from "../ui/Popover";
import { invoke } from "@tauri-apps/api/core";

const PANELS = [
  { id: "page", label: "Page" }, { id: "console", label: "Console" },
  { id: "network", label: "Network" }, { id: "files", label: "Files" },
  { id: "performance", label: "Performance" }, { id: "debug", label: "Debug" },
] as const;
type Panel = typeof PANELS[number]["id"];

export function BrowserPanel({ sessionId, onError }: { sessionId: string; onError: (message: string) => void }) {
  const [engine, setEngine] = useState<BrowserEngine>("webkit");
  const [panel, setPanel] = useState<Panel>("page");
  const browser = useBrowser(sessionId, engine);
  const active = browser.state.tabs.find(tab => tab.id === browser.state.activeTabId);
  const boxRef = useRef<HTMLDivElement>(null);
  const covered = useBoxCovered(boxRef, engine === "webkit" && panel === "page" && Boolean(active));
  useBrowserView(boxRef, sessionId, engine === "webkit" ? active?.id ?? null : null, panel === "page" && !covered && !browser.state.dialog, onError);
  const [localError, setLocalError] = useState<string | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const currentPanel = tabIds("browser-tools", panel);

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Browser">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="group" aria-label="Browser tabs">
          {browser.state.tabs.map(tab => (
            <div key={tab.id} className={`flex shrink-0 items-center rounded-md ${tab.id === active?.id ? "bg-chip" : ""}`}>
              <Button variant="ghost" size="sm" aria-pressed={tab.id === active?.id} onClick={() => run({ operation: "tabs.focus", tabId: tab.id })} className="max-w-40">
                <span className="truncate">{tab.title || "New tab"}</span>
              </Button>
              <IconButton label={`Close ${tab.title || "tab"}`} size="xs" onClick={() => run({ operation: "tabs.close", tabId: tab.id })}><X size={12} /></IconButton>
            </div>
          ))}
        </div>
        <IconButton label="New browser tab" size="sm" disabled={browser.busy} onClick={() => run({ operation: "tabs.open", url: "https://www.google.com/" })}><Plus size={14} /></IconButton>
        <label className="sr-only" htmlFor="browser-engine">Browser engine</label>
        <select id="browser-engine" value={engine} onChange={event => setEngine(event.target.value as BrowserEngine)} className="h-6 max-w-32 rounded-md border border-border bg-surface-2 px-1 text-ui-sm text-fg-secondary focus-ring">
          <option value="webkit">WebKit</option>
          <option value="chromium">Chromium debug</option>
        </select>
        <Popover isOpen={menuOpen} onClose={() => setMenuOpen(false)} label="Browser options" align="end" trigger={<IconButton label="Browser options" size="sm" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><MoreHorizontal size={14} /></IconButton>}>
          <PopoverOption onSelect={() => {
            setMenuOpen(false);
            void invoke("browser_permission", { sessionId, allow: false }).then(() => window.dispatchEvent(new CustomEvent("zorvo:browser-revoked", { detail: { sessionId } }))).catch(error => onError(String(error)));
          }}>Revoke browser access</PopoverOption>
        </Popover>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <IconButton label="Back" size="sm" disabled={!active?.canGoBack} onClick={() => run({ operation: "back", tabId: active?.id })}><ArrowLeft size={14} /></IconButton>
        <IconButton label="Forward" size="sm" disabled={!active?.canGoForward} onClick={() => run({ operation: "forward", tabId: active?.id })}><ArrowRight size={14} /></IconButton>
        <IconButton label={active?.loading ? "Stop loading" : "Reload page"} size="sm" disabled={!active} onClick={() => run({ operation: active?.loading ? "stop" : "reload", tabId: active?.id })}>{active?.loading ? <X size={14} /> : <RotateCw size={14} />}</IconButton>
        <Address key={`${sessionId}/${engine}/${active?.id ?? "new"}/${active?.url ?? ""}`} tab={active} onNavigate={navigate} />
      </div>
      <div className="shrink-0 overflow-x-auto border-b border-border px-2 py-1">
        <Tabs tabs={PANELS} selected={panel} onSelect={setPanel} label="Browser tools" idPrefix="browser-tools" itemPadding="shrink-0 px-2" />
      </div>
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
      <div role="tabpanel" id={currentPanel.panel} aria-labelledby={currentPanel.tab} className="flex min-h-0 flex-1 flex-col">
          <div ref={boxRef} className={`relative min-h-0 flex-1 ${panel === "page" ? "" : "hidden"}`} data-browser-box="">
            {!active ? <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-ui-sm text-fg-muted"><Globe size={24} /><p>Enter an address or search to open a page.</p></div> : engine === "chromium" ? <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-ui-sm text-fg-muted"><Globe size={24} /><p>Chromium debugging uses a separate browser window.</p><Button onClick={() => run({ operation: "tabs.focus", tabId: active.id })}>Show browser</Button></div> : null}
          </div>
        {panel !== "page" && <BrowserTools key={`${sessionId}/${engine}/${panel}`} panel={panel} sessionId={sessionId} engine={engine} tabId={active?.id} execute={browser.execute} />}
      </div>
    </div>
  );
}

function Address({ tab, onNavigate }: { tab: BrowserTab | undefined; onNavigate: (input: string) => void }) {
  const [text, setText] = useState(tab?.url ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); onNavigate(text); };
  return <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
    <input aria-label="Address or search" value={text} onChange={event => setText(event.target.value)} placeholder="Search or enter address" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-2 px-2 text-ui-sm text-fg focus-ring" />
    <Button type="submit" size="field" variant="ghost">Go</Button>
  </form>;
}
