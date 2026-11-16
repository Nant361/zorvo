import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentProfile, InstallStep } from "../types";
import { makeProfile } from "./fixtures/agents";

type Status = "idle" | "installing" | "failed";
const store = vi.hoisted(() => ({
  statuses: new Map<string, string>(),
  subscribers: new Set<() => void>(),
  started: [] as string[],
}));

vi.mock("../lib/agent-installs", () => ({
  installEntryOf: (id: string) => ({ status: store.statuses.get(id) ?? "idle" }),
  subscribeToInstalls: (onChange: () => void) => {
    store.subscribers.add(onChange);
    return () => store.subscribers.delete(onChange);
  },
  startInstall: (id: string) => {
    store.started.push(id);
    store.statuses.set(id, "installing");
    store.subscribers.forEach((notify) => notify());
  },
}));

import { useAutoInstall } from "../hooks/useAutoInstall";

const agentStep: InstallStep = { kind: "agent", name: "x", version: "1.0.0", download_bytes: null };
const npxAgent = (id: string): AgentProfile =>
  makeProfile({ id, name: id, distribution: "npx", availability: "not_installed", install_plan: [agentStep] });

function settle(id: string, status: Status) {
  store.statuses.set(id, status);
  store.subscribers.forEach((notify) => notify());
}

beforeEach(() => {
  store.statuses.clear();
  store.subscribers.clear();
  store.started.length = 0;
});

describe("useAutoInstall", () => {
  it("starts nothing until it is ready, then only the first agent", () => {
    const agentsInUse = [npxAgent("a"), npxAgent("b")];
    const { rerender } = renderHook((props: { isReady: boolean }) => useAutoInstall({ agentsInUse, isReady: props.isReady }), {
      initialProps: { isReady: false },
    });
    expect(store.started).toEqual([]);

    rerender({ isReady: true });

    expect(store.started).toEqual(["a"]);
  });

  it("starts the next agent when the one before it ends, however it ended", () => {
    renderHook(() => useAutoInstall({ agentsInUse: [npxAgent("a"), npxAgent("b"), npxAgent("c")], isReady: true }));

    settle("a", "failed");
    expect(store.started).toEqual(["a", "b"]);
    settle("b", "idle");

    expect(store.started).toEqual(["a", "b", "c"]);
  });

  it("does not start a failed agent again in the same run", () => {
    const { rerender } = renderHook(() => useAutoInstall({ agentsInUse: [npxAgent("a")], isReady: true }));

    settle("a", "failed");
    rerender();
    settle("a", "failed");

    expect(store.started).toEqual(["a"]);
  });

  it("skips an agent the user is already installing", () => {
    store.statuses.set("b", "installing");
    renderHook(() => useAutoInstall({ agentsInUse: [npxAgent("a"), npxAgent("b"), npxAgent("c")], isReady: true }));

    settle("a", "idle");

    expect(store.started).toEqual(["a", "c"]);
  });

  it("waits when the first agent is already installing, then goes on", () => {
    store.statuses.set("a", "installing");
    renderHook(() => useAutoInstall({ agentsInUse: [npxAgent("a"), npxAgent("b")], isReady: true }));

    expect(store.started).toEqual(["b"]);
  });

  it("takes its agents once: a later list starts nothing more", () => {
    const { rerender } = renderHook((props: { agents: AgentProfile[] }) => useAutoInstall({ agentsInUse: props.agents, isReady: true }), {
      initialProps: { agents: [npxAgent("a")] },
    });
    settle("a", "idle");

    rerender({ agents: [npxAgent("a"), npxAgent("z")] });
    settle("a", "idle");

    expect(store.started).toEqual(["a"]);
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = renderHook(() => useAutoInstall({ agentsInUse: [npxAgent("a"), npxAgent("b")], isReady: true }));

    unmount();
    settle("a", "idle");

    expect(store.subscribers.size).toBe(0);
    expect(store.started).toEqual(["a"]);
  });
});
