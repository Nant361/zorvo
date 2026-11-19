import { describe, it, expect, vi } from "vitest";
import { importedSessionSpec, isWaitingForAnswer, namingFor, newSessionRecord, titleFor, titlePlaceOf } from "../lib/session-start";
import type { ListedSession } from "../lib/session-list";
import { TRANSPORT_ACP, type AgentProfile, type ChatMessage, type Session } from "../types";

const QWEN = { id: "qwen" } as AgentProfile;
const CLAUDE = { id: "claude-acp", name: "Claude Code" } as AgentProfile;

describe("newSessionRecord", () => {
  it("records a running session with the spec's agent, folder and fork source", () => {
    const worktree = { repoPath: "/w/api", path: "/data/worktrees/api/fix", branch: "agent/fix" };

    const session = newSessionRecord(
      {
        id: "s-1",
        agent: QWEN,
        cwd: "/data/worktrees/api/fix",
        name: "Fix it",
        forkedFrom: "s-0",
        worktree,
      },
      1234,
    );

    expect(session).toEqual({
      id: "s-1",
      name: "Fix it",
      profileId: "qwen",
      cwd: "/data/worktrees/api/fix",
      status: "running",
      createdAt: 1234,
      forkedFrom: "s-0",
      transport: TRANSPORT_ACP,
      worktree,
      acpSessionId: null,
    });
  });

  it("copies the spec's compareRunId onto the record", () => {
    const session = newSessionRecord({ agent: QWEN, cwd: "/w/api", name: "Compare", compareRunId: "run-1" }, 1);

    expect(session.compareRunId).toBe("run-1");
  });

  it("makes up an id, and leaves out what the spec does not give", () => {
    const session = newSessionRecord({ agent: QWEN, cwd: "/w/api", name: "Session #1" }, 1);

    expect(session.id).toMatch(/^s-/);
    expect(session).toMatchObject({ forkedFrom: null, worktree: null, acpSessionId: null });
  });

  it("records the agent session an import reopens", () => {
    const session = newSessionRecord(
      { agent: QWEN, cwd: "/w/api", name: "Imported", acpSessionId: "acp-listed" },
      1,
    );

    expect(session.acpSessionId).toBe("acp-listed");
  });
});

describe("importedSessionSpec", () => {
  const listed = (title: string | undefined, updatedAt: string | undefined = "2026-10-20T08:00:00Z"): ListedSession => ({
    acpSessionId: "acp-listed",
    ...(title === undefined ? {} : { title }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });

  it("names an imported session whose listed title is only a command by its agent and folder", () => {
    const spec = importedSessionSpec(listed("/init"), CLAUDE, "/w/antigravity-bridge", 1);
    expect(spec.name).toBe("Claude Code in antigravity-bridge");
    expect(spec.titleSource).toBe("/init");
  });

  it("names the session after its title in the agent's list", () => {
    const spec = importedSessionSpec(listed("Fix the login bug"), CLAUDE, "/w/zorvo", 1);

    expect(spec).toEqual({
      agent: CLAUDE,
      cwd: "/w/zorvo",
      name: "Fix the login bug",
      acpSessionId: "acp-listed",
    });
  });

  it("carries the agent session id to reopen", () => {
    expect(importedSessionSpec(listed("Fix the login bug"), CLAUDE, "/w/zorvo", 1).acpSessionId).toBe("acp-listed");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "  \n\t "],
  ])("names the session for the agent and date when its title is %s", (_case, title) => {
    expect(importedSessionSpec(listed(title), CLAUDE, "/w/zorvo", 1).name).toBe("Claude Code session, 20 Oct");
  });

  it("names the session for the agent and date when it has no title", () => {
    expect(importedSessionSpec(listed(undefined), CLAUDE, "/w/zorvo", 1).name).toBe(
      "Claude Code session, 20 Oct",
    );
  });

  it("uses the date the session was last updated", () => {
    expect(importedSessionSpec(listed(undefined, "2026-10-18T08:00:00Z"), CLAUDE, "/w/zorvo", 1).name).toBe(
      "Claude Code session, 18 Oct",
    );
  });

  it("dates a session the list left undated by the import time", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");

    expect(importedSessionSpec(listed(undefined, undefined), CLAUDE, "/w/zorvo", now).name).toBe(
      "Claude Code session, 20 Oct",
    );
  });

  it("dates a session with an unreadable updated time by the import time", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");

    expect(importedSessionSpec(listed(undefined, "2026-10-20T08:00:60Z"), CLAUDE, "/w/zorvo", now).name).toBe(
      "Claude Code session, 20 Oct",
    );
  });

  it("keeps a multi-line markdown title on one line", () => {
    const spec = importedSessionSpec(
      listed("# Fix the login\n\nSome **details**\nand more"),
      CLAUDE,
      "/w/zorvo",
      1,
    );

    expect(spec.name).toBe("# Fix the login");
    expect(spec.name).not.toContain("\n");
  });
});

describe("isWaitingForAnswer", () => {
  const pending: ChatMessage[] = [
    {
      id: "m-1",
      role: "agent",
      content: "",
      timestamp: 1,
      actionCard: { id: "c-1", sessionId: "s-1", title: "Run it?", prompt: "Run it?", status: "pending", requestId: 7 },
    } as ChatMessage,
  ];
  const acp = { status: "running", transport: TRANSPORT_ACP } as Session;

  it("waits on an ACP agent that is still busy with an unanswered request", () => {
    expect(isWaitingForAnswer(acp, pending, () => true)).toBe(true);
    expect(isWaitingForAnswer(acp, pending, () => false)).toBe(false);
    expect(isWaitingForAnswer(acp, [], () => true)).toBe(false);
  });

  it("waits on an elicitation even between turns", () => {
    const asking = [
      {
        id: "m-2",
        role: "agent",
        content: "",
        timestamp: 2,
        elicitation: { key: "el-1", sessionId: "s-1", mode: "form", message: "Name?", status: "pending", timestamp: 2 },
      } as ChatMessage,
    ];
    expect(isWaitingForAnswer(acp, asking, () => false)).toBe(true);
    expect(isWaitingForAnswer({ ...acp, status: "terminated" }, asking, () => false)).toBe(false);
  });

  it("asks whether the agent is busy only for a running session", () => {
    const isBusy = vi.fn(() => true);

    isWaitingForAnswer({ ...acp, status: "terminated" }, pending, isBusy);
    expect(isBusy).not.toHaveBeenCalled();
    isWaitingForAnswer(acp, pending, isBusy);
    expect(isBusy).toHaveBeenCalledTimes(1);
  });

  it("waits on nothing in a session that is not running", () => {
    expect(isWaitingForAnswer({ ...acp, status: "terminated" }, pending, () => true)).toBe(false);
    expect(isWaitingForAnswer(undefined, pending, () => true)).toBe(false);
  });
});

describe("titleFor", () => {
  const place = { agentName: "Qwen Code", folderName: "antigravity-bridge" };

  it("names a session whose first message is only a command by its agent and folder", () => {
    expect(titleFor({ text: "/init" }, place)).toBe("Qwen Code in antigravity-bridge");
    expect(titleFor({ text: "/review src/App.tsx" }, place)).toBe("Qwen Code in antigravity-bridge");
  });

  it("takes any other message as it is, tidied, and a command when no place is known", () => {
    expect(titleFor({ text: "fix the login bug" }, place)).toBe("fix the login bug");
    expect(titleFor({ text: "/init" })).toBe("/init");
    expect(titleFor({ text: "", attachments: ["/Users/mac/shots/screen.png"] }, place)).toBe("screen.png");
    // Stray spaces are not text: the file still names the session.
    expect(titleFor({ text: "   ", attachments: ["/Users/mac/shots/screen.png"] }, place)).toBe("screen.png");
  });
});

describe("namingFor", () => {
  it("keeps the whole first line only when the name shortened it", () => {
    const text = "cek https://docs.near.ai/cloud/verification lalu bandingkan dengan verify.rs\nand more";
    expect(namingFor({ text })).toEqual({
      name: "cek docs.near.ai lalu bandingkan dengan verify.rs",
      titleSource: "cek https://docs.near.ai/cloud/verification lalu bandingkan dengan verify.rs",
    });
    expect(namingFor({ text: "fix the login bug" })).toEqual({ name: "fix the login bug" });
    expect(namingFor({ text: "/init" }, { agentName: "Qwen Code", folderName: "zorvo" })).toEqual({
      name: "Qwen Code in zorvo",
      titleSource: "/init",
    });
  });

  it("records the line on the new session", () => {
    const record = newSessionRecord({ agent: CLAUDE, cwd: "/w", ...namingFor({ text: "see https://github.com/a/b/issues/3" }) });
    expect(record.name).toBe("see a/b");
    expect(record.titleSource).toBe("see https://github.com/a/b/issues/3");
  });
});

describe("titlePlaceOf", () => {
  const base = { id: "s-1", name: "Session #1", profileId: "claude-acp", status: "idle", createdAt: 1, transport: TRANSPORT_ACP } as Session;

  it("names the agent and the folder, the repository's for a session in a worktree", () => {
    expect(titlePlaceOf({ ...base, cwd: "/w/zorvo" }, [CLAUDE])).toEqual({ agentName: "Claude Code", folderName: "zorvo" });
    const inWorktree = { ...base, cwd: "/data/worktrees/zorvo/fix", worktree: { repoPath: "/w/zorvo", path: "/data/worktrees/zorvo/fix", branch: "agent/fix" } };
    expect(titlePlaceOf(inWorktree, [CLAUDE])).toEqual({ agentName: "Claude Code", folderName: "zorvo" });
  });

  it("has no place when the agent is not known", () => {
    expect(titlePlaceOf({ ...base, cwd: "/w/zorvo" }, [QWEN])).toBeUndefined();
  });
});
