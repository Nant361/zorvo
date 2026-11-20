import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, MoreHorizontal, RefreshCw, SlidersHorizontal, SquareMousePointer, X } from "lucide-react";
import type { BrowserEngine, BrowserTab } from "../../lib/browser";
import { IconButton } from "../ui/IconButton";
import { Popover, PopoverGroup, PopoverOption } from "../ui/Popover";

export const BROWSER_PANELS = [
  { id: "page", label: "Page" }, { id: "console", label: "Console" },
  { id: "network", label: "Network" }, { id: "files", label: "Files" },
  { id: "performance", label: "Performance" }, { id: "debug", label: "Debug" },
] as const;
export type BrowserPanelId = typeof BROWSER_PANELS[number]["id"];
export type BrowserOverlay = "options" | "site" | null;

interface BrowserToolbarProps {
  tabs: BrowserTab[];
  active?: BrowserTab;
  engine: BrowserEngine;
  panel: BrowserPanelId;
  busy: boolean;
  overlay: BrowserOverlay;
  onOverlay: (overlay: BrowserOverlay) => void;
  onNavigate: (value: string) => void;
  onAction: (args: Record<string, unknown>) => void;
  onEngine: (engine: BrowserEngine) => void;
  onPanel: (panel: BrowserPanelId) => void;
  onRevoke: () => void;
  onSelectElement?: () => void;
  selectingElement?: boolean;
}

function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
  event.preventDefault();
}

/** The page keeps one navigation row; less frequent controls live in its menu. */
export function BrowserToolbar({ tabs, active, engine, panel, busy, overlay, onOverlay, onNavigate, onAction, onEngine, onPanel, onRevoke, onSelectElement, selectingElement }: BrowserToolbarProps) {
  const menu = useRef<HTMLDivElement>(null);
  const choose = (action: () => void) => { onOverlay(null); action(); };
  let origin = "No page open";
  try { if (active) origin = new URL(active.url).origin; } catch { /* A loading tab may not have a web address yet. */ }
  return <div role="toolbar" aria-label="Browser navigation" className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 [&_svg]:stroke-1">
    <div className="flex shrink-0 items-center">
      <IconButton label="Navigate back" size="md" disabled={busy || !active?.canGoBack} onClick={() => onAction({ operation: "back", tabId: active?.id })}><ArrowLeft size={16} /></IconButton>
      <IconButton label="Navigate forward" size="md" disabled={busy || !active?.canGoForward} onClick={() => onAction({ operation: "forward", tabId: active?.id })}><ArrowRight size={16} /></IconButton>
      <IconButton label={active?.loading ? "Stop loading" : "Reload page"} size="md" disabled={!active} onClick={() => onAction({ operation: active?.loading ? "stop" : "reload", tabId: active?.id })}>
        {active?.loading ? <X size={16} /> : <RefreshCw size={16} />}
      </IconButton>
    </div>
    <Address key={`${engine}/${active?.id ?? "new"}/${active?.url ?? ""}`} tab={active} onNavigate={onNavigate}
      siteButton={<Popover isOpen={overlay === "site"} onClose={() => onOverlay(null)} role="dialog" label="Site information" className="w-64"
        trigger={<IconButton label="Site information" size="xs" disabled={!active} aria-haspopup="dialog" aria-expanded={overlay === "site"} onClick={() => onOverlay(overlay === "site" ? null : "site")}><SlidersHorizontal size={13} /></IconButton>}>
        <p className="break-all px-2 py-1 text-ui text-fg">{origin}</p>
        <p className="px-2 py-1 text-caption text-fg-muted">Camera, microphone and location are blocked.</p>
      </Popover>} />
    <div className="flex shrink-0 items-center">
      <IconButton label="Select an element to comment on" size="md" disabled={busy || !active || !onSelectElement} aria-pressed={Boolean(selectingElement)} onClick={onSelectElement}><SquareMousePointer size={16} /></IconButton>
      <Popover isOpen={overlay === "options"} onClose={() => onOverlay(null)} align="end" label="Browser options" className="w-56"
        trigger={<IconButton label="Browser options" size="md" aria-haspopup="menu" aria-expanded={overlay === "options"} onClick={() => onOverlay(overlay === "options" ? null : "options")}
          onKeyDown={event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            onOverlay("options");
            requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus());
          }}><MoreHorizontal size={16} /></IconButton>}>
        <div ref={menu} onKeyDown={menuKeys}>
          <PopoverOption disabled={busy} onSelect={() => choose(() => onAction({ operation: "tabs.open", url: "https://www.google.com/" }))}>New tab</PopoverOption>
          <PopoverOption disabled={busy || !active} onSelect={() => choose(() => onAction({ operation: "tabs.close", tabId: active?.id }))}>Close tab</PopoverOption>
          {tabs.length > 0 && <PopoverGroup heading="Tabs">{tabs.map(tab => <PopoverOption key={tab.id} isRadio selected={tab.id === active?.id} disabled={busy} title={tab.url}
            onSelect={() => choose(() => onAction({ operation: "tabs.focus", tabId: tab.id }))}>{tab.title || "New tab"}</PopoverOption>)}</PopoverGroup>}
          <PopoverGroup heading="Tools">{BROWSER_PANELS.map(item => <PopoverOption key={item.id} isRadio selected={item.id === panel} onSelect={() => choose(() => onPanel(item.id))}>{item.label}</PopoverOption>)}</PopoverGroup>
          <PopoverGroup heading="Browser engine">
            <PopoverOption isRadio selected={engine === "webkit"} onSelect={() => choose(() => onEngine("webkit"))}>WebKit</PopoverOption>
            <PopoverOption isRadio selected={engine === "chromium"} onSelect={() => choose(() => onEngine("chromium"))}>Chromium debug</PopoverOption>
          </PopoverGroup>
          <div role="separator" className="my-1 border-t border-border" />
          <PopoverOption onSelect={() => choose(onRevoke)}>Revoke browser access</PopoverOption>
        </div>
      </Popover>
    </div>
  </div>;
}

function Address({ tab, onNavigate, siteButton }: { tab: BrowserTab | undefined; onNavigate: (value: string) => void; siteButton: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const url = tab?.url ?? "";
  const editing = draft !== null;
  const parts = /^([a-z][a-z\d+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(url);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onNavigate(draft ?? url);
    setDraft(null);
    input.current?.blur();
  };
  return <form onSubmit={submit} className="relative flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 pr-2 pl-1 focus-ring-within hover:bg-surface-hover">
    {siteButton}
    <div className="relative h-full min-w-0 flex-1">
      <input ref={input} aria-label="Address or search" value={draft ?? url} placeholder="Search or enter a URL"
        autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
        onFocus={event => { setDraft(url); event.currentTarget.select(); }} onBlur={() => setDraft(null)}
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") input.current?.blur(); }}
        className={`absolute inset-0 h-full w-full min-w-0 bg-transparent text-ui outline-none ${editing || !url ? "text-fg" : "text-transparent"}`} />
      {!editing && url && <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-ui"><span className="truncate text-fg-muted">{parts?.[1]}<span className="text-fg">{parts?.[2]}</span>{parts?.[3]}</span></div>}
    </div>
  </form>;
}
