import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, callback: Listener) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
import { BrowserPanel } from "../components/browser/BrowserPanel";
import { BrowserTools } from "../components/browser/BrowserTools";
import { useBrowserOpening } from "../hooks/useBrowserOpening";
import { requestBrowserOpen } from "../lib/browser";
import { renderHook } from "@testing-library/react";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });
const empty = { sessionId: "s1", tabs: [], activeTabId: null };

describe("browser panel", () => {
  it("hides the native page when a debug panel replaces it and restores the retained box", async () => {
    const state = { sessionId:"s1", tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    const invoke=vi.spyOn(internals(),"invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await screen.findByRole("button",{name:"Example"});
    const box=document.querySelector("[data-browser-box]");
    fireEvent.click(screen.getByRole("tab",{name:"Console"}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith("browser_bounds",{sessionId:"s1",tabId:"t1",bounds:null,visible:false},undefined));
    expect(document.querySelector("[data-browser-box]")).toBe(box);
    expect(box?.classList.contains("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("tab",{name:"Page"}));
    expect(document.querySelector("[data-browser-box]")).toBe(box);
    expect(box?.classList.contains("hidden")).toBe(false);
  });
  it("opens search text as a page without starting an agent or background server", async () => {
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(empty);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.list", engine: "webkit" } }, undefined));
    fireEvent.change(screen.getByRole("textbox", { name: "Address or search" }), { target: { value: "google" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Go" })); });
    expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.open", engine: "webkit", url: "https://www.google.com/search?q=google" } }, undefined);
    expect(invoke.mock.calls.every(([command]) => command.startsWith("browser_") || command.startsWith("plugin:event"))).toBe(true);
  });
  it("uses the manual file approval receipt before transferring files", async () => {
    const execute = vi.fn().mockResolvedValue({ requiresFileApproval: { url: "https://example.com/upload", paths: ["/workspace/report.txt"], approvalId: "approval-1" } });
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue({ sent: true });
    render(<BrowserTools panel="files" sessionId="s1" engine="chromium" tabId="t1" execute={execute} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Browser tool action" }), { target: { value: "files.upload" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run" })); });
    expect(screen.getByRole("group", { name: "File transfer permission" }).textContent).toContain("/workspace/report.txt");
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Allow once" })); });
    expect(invoke).toHaveBeenCalledWith("browser_manual_file_permission", { sessionId: "s1", approvalId: "approval-1", allow: true }, undefined);
  });
});

it("opens a right-click link through the active session without ACP", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const show = vi.fn();
  renderHook(() => useBrowserOpening({ sessionId: "s1", show, onError: vi.fn() }));
  await act(async () => requestBrowserOpen("https://example.com/"));
  expect(show).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.open", url: "https://example.com/" } }, undefined);
});
