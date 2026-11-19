import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within, waitFor } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";
import qwen from "./fixtures/acp-subagent-qwen.json";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
const callsTo = (spy: { mock: { calls: unknown[][] } }, cmd: string) =>
  (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd);

async function acpEvent(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const prompt = () => screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;

async function send(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

/** A session whose second turn ran the recorded Qwen Code subagent, and ended. */
async function sessionWithSubagent() {
  fakeStore().state.settings.defaultAgentId = "qwen";
  const spy = vi.spyOn(tauriInternals(), "invoke");
  await act(async () => {
    render(<App />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
  });
  await send("get started");
  await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
  const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
  await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });
  await send("read the notes");
  for (const update of qwen.updates) await acpEvent({ sessionId, kind: "update", update });
  await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });
  return { sessionId, spy };
}

const taskRow = () => screen.getByRole("button", { name: /^Open Agent: read the notes\. Done, 2 steps\.$/ });
const inspector = () => screen.queryByRole("region", { name: "Inspector" });

describe("task tabs in the app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("shows a subagent as one row, with its text kept out of the reply", async () => {
    await sessionWithSubagent();

    expect(taskRow()).toBeDefined();
    expect(within(screen.getByTestId("chat-canvas-container")).queryByText("notes.txt starts with alpha line.")).toBeNull();
  });

  it("opens a subagent's tab beside the chat when its row is pressed", async () => {
    await sessionWithSubagent();

    await act(async () => {
      fireEvent.click(taskRow());
    });

    const panel = within(inspector()!);
    expect(panel.getByRole("tab", { name: /^Tasks/ }).getAttribute("aria-selected")).toBe("true");
    expect(panel.getByRole("heading", { name: "Agent: read the notes" })).toBeDefined();
    expect(panel.getByText("notes.txt starts with alpha line.")).toBeDefined();
    expect(taskRow().getAttribute("aria-pressed")).toBe("true");
  });

  it("takes the Tasks tab away when its last task tab closes", async () => {
    await sessionWithSubagent();
    await act(async () => {
      fireEvent.click(taskRow());
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close Agent: read the notes" }));
    });

    expect(screen.queryByRole("tab", { name: /^Tasks/ })).toBeNull();
    expect(taskRow().getAttribute("aria-pressed")).toBe("false");
  });

  it("closes a subagent's tab when a rewind removes its message", async () => {
    await sessionWithSubagent();
    await act(async () => {
      fireEvent.click(taskRow());
    });

    const yours = screen.getByText("read the notes", { selector: "p" }).closest("[data-testid^='chat-message-']") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(yours).getByRole("button", { name: "Rewind to here" }));
    });
    await act(async () => {
      fireEvent.click(within(yours).getByRole("button", { name: "Confirm rewind" }));
    });

    await waitFor(() => expect(screen.queryByRole("tab", { name: /^Tasks/ })).toBeNull());
    expect(screen.queryByRole("heading", { name: "Agent: read the notes" })).toBeNull();
  });
});
