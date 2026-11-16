import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
    });
  },
  emit: () => Promise.resolve(),
}));

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }));

import { useArtifacts } from "../hooks/useArtifacts";

const artifact = (title: string, at = 1) => ({
  id: "a-0123456789abcdef",
  title,
  sourcePath: "/w/a.html",
  versions: [{ n: 1, at, bytes: 1 }],
});

function deliver(sessionId: unknown) {
  (listeners.get("artifacts-changed") ?? []).forEach((cb) => cb({ payload: { sessionId } }));
}

afterEach(() => {
  invoke.mockReset();
  listeners.clear();
});

describe("useArtifacts", () => {
  it("lists the sessions it is given", async () => {
    invoke.mockResolvedValue([{ sessionId: "s-1", artifacts: [artifact("One")] }, { sessionId: "s-2", artifacts: [] }]);

    const { result } = renderHook(() => useArtifacts(["s-1", "s-2"]));

    await waitFor(() => expect(result.current.bySession.get("s-1")?.[0].title).toBe("One"));
    expect(invoke).toHaveBeenCalledWith("artifact_list", { sessionIds: ["s-1", "s-2"] });
    expect(result.current.bySession.get("s-2")).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it("asks nothing for no sessions", () => {
    renderHook(() => useArtifacts([]));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads one session again when it changed", async () => {
    invoke.mockResolvedValueOnce([{ sessionId: "s-1", artifacts: [artifact("One")] }]);
    const { result } = renderHook(() => useArtifacts(["s-1"]));
    await waitFor(() => expect(result.current.bySession.get("s-1")).toHaveLength(1));
    invoke.mockResolvedValueOnce([{ sessionId: "s-1", artifacts: [artifact("Renamed")] }]);

    act(() => deliver("s-1"));

    await waitFor(() => expect(result.current.bySession.get("s-1")?.[0].title).toBe("Renamed"));
    expect(invoke).toHaveBeenLastCalledWith("artifact_list", { sessionIds: ["s-1"] });
  });

  it("ignores a change for a session it was not given, and a malformed event", async () => {
    invoke.mockResolvedValueOnce([{ sessionId: "s-1", artifacts: [] }]);
    const { result } = renderHook(() => useArtifacts(["s-1"]));
    await waitFor(() => expect(result.current.bySession.has("s-1")).toBe(true));

    act(() => {
      deliver("s-9");
      deliver(42);
    });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that arrives for an older list of sessions", async () => {
    let answerFirst: (value: unknown) => void = () => undefined;
    invoke.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    invoke.mockResolvedValueOnce([{ sessionId: "s-2", artifacts: [artifact("Two")] }]);
    const { result, rerender } = renderHook(({ ids }) => useArtifacts(ids), { initialProps: { ids: ["s-1"] } });

    rerender({ ids: ["s-2"] });
    await waitFor(() => expect(result.current.bySession.get("s-2")).toHaveLength(1));
    await act(async () => answerFirst([{ sessionId: "s-1", artifacts: [artifact("Late")] }]));

    expect(result.current.bySession.has("s-1")).toBe(false);
  });

  it("says when the list could not be read", async () => {
    invoke.mockRejectedValue(new Error("no"));
    const { result } = renderHook(() => useArtifacts(["s-1"]));
    await waitFor(() => expect(result.current.error).toBe(true));
  });
});
