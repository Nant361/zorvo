import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAcpEngine } from "../hooks/session-engine/useAcpEngine";
import { fakeProfiles } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const SESSION: Session = {
  id: "s-1",
  name: "Stuck glob",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
};

const emit = (payload: Record<string, unknown>) =>
  act(async () => {
    listeners.get("acp-event")?.({ payload: { sessionId: "s-1", ...payload } });
  });

function renderEngine() {
  let sessions: Session[] = [SESSION];
  let messages: ChatMessage[] = [];
  const hook = renderHook(() =>
    useAcpEngine({
      sessions,
      agents: fakeProfiles,
      updateMessages: (_id, change) => {
        messages = change(messages);
      },
      patchSession: (_id, patch) => {
        sessions = sessions.map((s) => ({ ...s, ...patch }));
      },
      reportError: vi.fn(),
      rememberOptions: () => {},
      onAuthRequired: () => {},
    }),
  );
  return { ...hook, session: () => sessions[0] };
}

async function startTurn(engine: ReturnType<typeof renderEngine>) {
  await act(async () => {
    await engine.result.current.start(SESSION, { text: "find the screenshot" });
  });
  await waitFor(() => expect(engine.result.current.isBusy("s-1")).toBe(true));
}

describe("useAcpEngine when Stop is pressed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("remembers when Stop was pressed until the turn ends", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();

    const before = Date.now();
    act(() => engine.result.current.interrupt("s-1", []));
    expect(engine.result.current.stopAskedAt("s-1")).toBeGreaterThanOrEqual(before);

    await emit({ kind: "turn-end", stopReason: "cancelled" });
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();
  });

  it("keeps the first Stop's time when Stop is pressed again", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    act(() => engine.result.current.interrupt("s-1", []));
    now.mockReturnValue(9_000);
    act(() => engine.result.current.interrupt("s-1", []));

    expect(engine.result.current.stopAskedAt("s-1")).toBe(1_000);
  });

  it("ends the agent's process and the session for a Stop the agent ignored", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startTurn(engine);
    act(() => engine.result.current.interrupt("s-1", []));

    let ended = false;
    await act(async () => {
      ended = await engine.result.current.endAgent("s-1");
    });

    expect(ended).toBe(true);
    expect(spy.mock.calls.filter(([cmd]) => cmd === "acp_stop_session").map(([, args]) => args)).toEqual([{ sessionId: "s-1" }]);
    expect(engine.session().status).toBe("terminated");
    expect(engine.result.current.isBusy("s-1")).toBe(false);
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();
  });
});
