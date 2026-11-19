import { describe, expect, it } from "vitest";
import { applyAcpUpdate, applyPermissionRequest, applyReplayUpdate, partsOf, resolvePermissionCard, type AcpReducerContext } from "../lib/acp-events";
import { buildForkHandoff } from "../lib/fork-handoff";
import { MAX_SUBAGENT_TEXT, parentToolIdOf } from "../lib/acp-subagents";
import type { ChatMessage } from "../types";
import qwen from "./fixtures/acp-subagent-qwen.json";
import claude from "./fixtures/acp-subagent-claude.json";

type Fixture = { parentId: string; updates: Record<string, unknown>[] };
const FIXTURES: Record<string, Fixture> = { qwen, claude };

function ctx(): AcpReducerContext {
  let n = 0;
  return { sessionId: "s-1", now: 1000, createId: (prefix) => `${prefix}-${++n}` };
}

function fold(updates: readonly unknown[], apply = applyAcpUpdate): ChatMessage[] {
  const c = ctx();
  return updates.reduce<ChatMessage[]>((messages, update) => apply(messages, update, c), []);
}

const toolIdsInParts = (reply: ChatMessage) => partsOf(reply).flatMap((p) => (p.kind === "tools" ? p.toolIds : []));

describe("a subagent's updates", () => {
  it.each(["qwen", "claude"])("files a %s subagent under its parent", (name) => {
    const { updates, parentId } = FIXTURES[name];

    const reply = fold(updates).at(-1)!;

    const parent = reply.tools!.find((t) => t.id === parentId)!;
    expect(reply.tools!.filter((t) => t.parentId === parentId).map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(toolIdsInParts(reply)).toEqual([parentId]);
    expect(reply.content).toBe("");
    expect(parent.steps).toEqual([
      { kind: "tools", toolIds: ["c1", "c2"] },
      { kind: "text", text: "notes.txt starts with alpha line." },
    ]);
    expect(parent.thinking).toMatch(/hypothesis/i);
    expect(reply.thinking ?? "").toBe("");
    expect(parent.status).toBe("completed");
  });

  it("keeps the subagent type Qwen Code reports on the parent", () => {
    const reply = fold(qwen.updates).at(-1)!;

    expect(reply.tools!.find((t) => t.id === qwen.parentId)!.agentType).toBe("general-purpose");
  });

  it("folds a child whose parent is not in the open reply as before", () => {
    const reply = fold(qwen.updates.slice(1, -1)).at(-1)!;

    expect(toolIdsInParts(reply)).toEqual(["c1", "c2"]);
    expect(reply.content).toBe("notes.txt starts with alpha line.");
    expect(reply.thinking).toMatch(/hypothesis/i);
    expect(reply.tools!.some((t) => t.steps || t.parentId)).toBe(false);
  });

  it("gives the same tools and steps from a replay", () => {
    const live = fold(qwen.updates).at(-1)!;
    const replayed = fold(qwen.updates, applyReplayUpdate).at(-1)!;

    expect(replayed.tools!.map(({ startedAt: _s, ...tool }) => tool)).toEqual(
      live.tools!.map(({ startedAt: _s, ...tool }) => tool),
    );
    expect(replayed.parts).toEqual(live.parts);
  });

  it("cuts a subagent's text at the cap and ignores what comes after", () => {
    const chunk = (text: string) => ({ ...qwen.updates[6], content: { type: "text", text } });
    const updates = [qwen.updates[0], chunk("a".repeat(15_000)), chunk("b".repeat(15_000)), chunk("c")];

    const parent = fold(updates).at(-1)!.tools![0];

    const text = parent.steps!.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("");
    expect(text).toHaveLength(MAX_SUBAGENT_TEXT);
    expect(text.endsWith("b")).toBe(true);
    expect(parent.isTextCut).toBe(true);
  });

  it("reads a parent id only from a non-empty string", () => {
    expect(parentToolIdOf({ parentToolCallId: "p" })).toBe("p");
    expect(parentToolIdOf({ claudeCode: { parentToolUseId: "q" } })).toBe("q");
    for (const meta of [{ parentToolCallId: "" }, { parentToolCallId: 7 }, { claudeCode: { parentToolUseId: null } }, {}, null, "p"]) {
      expect(parentToolIdOf(meta)).toBeUndefined();
    }
  });

  it("files a subagent's own subagent under the nearest ancestor the reply lists", () => {
    const nested = { ...qwen.updates[2], toolCallId: "g1", _meta: { ...qwen.updates[2]._meta, parentToolCallId: "c1" } };

    const reply = fold([...qwen.updates.slice(0, 3), nested]).at(-1)!;

    const parent = reply.tools!.find((t) => t.id === qwen.parentId)!;
    expect(reply.tools!.find((t) => t.id === "g1")!.parentId).toBe(qwen.parentId);
    expect(parent.steps).toEqual([{ kind: "tools", toolIds: ["c1", "g1"] }]);
    expect(reply.tools!.find((t) => t.id === "c1")!.steps).toBeUndefined();
  });

  it("keeps filing a subagent's updates under its parent after a permission was answered", () => {
    const c = ctx();
    const options = [{ optionId: "allow", name: "Allow", kind: "allow_once" }];
    let messages = qwen.updates.slice(0, 3).reduce<ChatMessage[]>((all, update) => applyAcpUpdate(all, update, c), []);
    messages = applyPermissionRequest(messages, { requestId: 1, toolCall: { toolCallId: "c1", title: "Read" }, options }, c);
    messages = resolvePermissionCard(messages, messages.at(-1)!.actionCard!.id, "allow");

    // The subagent goes on: another tool call, its text, and more reasoning.
    for (const update of [qwen.updates[4], qwen.updates[6], qwen.updates[1]]) messages = applyAcpUpdate(messages, update, c);

    const withParent = messages.find((m) => m.tools?.some((t) => t.id === qwen.parentId))!;
    const parent = withParent.tools!.find((t) => t.id === qwen.parentId)!;
    expect(parent.steps).toEqual([
      { kind: "tools", toolIds: ["c1", "c2"] },
      { kind: "text", text: "notes.txt starts with alpha line." },
    ]);
    expect(withParent.tools!.find((t) => t.id === "c2")!.parentId).toBe(qwen.parentId);
    expect(messages.every((m) => m.content === "")).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it("does not reach for a parent in an earlier turn", () => {
    const c = ctx();
    let messages = qwen.updates.slice(0, 1).reduce<ChatMessage[]>((all, update) => applyAcpUpdate(all, update, c), []);
    messages = [...messages.map((m) => ({ ...m, isComplete: true })), { id: "u2", role: "user", content: "next", timestamp: 2 }];

    messages = applyAcpUpdate(messages, qwen.updates[6], c);

    expect(messages.at(-1)).toMatchObject({ role: "agent", content: "notes.txt starts with alpha line." });
    expect(messages[0].tools![0].steps).toBeUndefined();
  });

  it("writes a subagent's text into a handoff", () => {
    const messages = fold(qwen.updates);

    const doc = buildForkHandoff(messages, messages.at(-1)!.id, { sourceSessionName: "s", agentName: "Qwen Code", cwd: "/w", createdAt: 0 });

    expect(doc).toContain("notes.txt starts with alpha line.");
    expect(doc).toContain("- Tool: Agent: read the notes");
    expect(doc).toContain("  - Tool: ReadFile: notes.txt");
  });
});
