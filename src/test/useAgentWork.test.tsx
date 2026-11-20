import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentWork } from "../hooks/useAgentWork";
import type { ChatMessage, Session } from "../types";

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  name: id,
  profileId: "qwen-code",
  cwd: "/w/titan",
  status: "idle",
  createdAt: 1,
  ...overrides,
});

const madeBranch: ChatMessage = {
  id: "m1",
  role: "agent",
  content: "",
  timestamp: 1,
  tools: [{ id: "t1", name: "Shell", kind: "execute", status: "completed", command: "git worktree add -b fix/notice .qwen/worktrees/n" }],
};

describe("useAgentWork", () => {
  it("records what a loaded transcript shows, once, and leaves unloaded sessions alone", () => {
    const patch = vi.fn();
    const sessions = [session("loaded"), session("unloaded", { agentWork: { branches: ["old/one"], pullRequestUrls: [] } })];
    const { rerender } = renderHook(({ list }) => useAgentWork(list, { loaded: [madeBranch] }, patch), { initialProps: { list: sessions } });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("loaded", { agentWork: { branches: ["fix/notice"], pullRequestUrls: [] } });

    patch.mockClear();
    rerender({ list: [session("loaded", { agentWork: { branches: ["fix/notice"], pullRequestUrls: [] } }), sessions[1]] });
    expect(patch).not.toHaveBeenCalled();
  });
});
