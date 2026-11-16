import { describe, expect, it } from "vitest";
import { applyAcpUpdate, type AcpReducerContext } from "../lib/acp-events";
import { normalizeTranscript } from "../lib/persistence";
import type { ChatMessage } from "../types";
import qwen from "./fixtures/acp-subagent-qwen.json";

function folded(): ChatMessage[] {
  let n = 0;
  const ctx: AcpReducerContext = { sessionId: "s-1", now: 1000, createId: (prefix) => `${prefix}-${++n}` };
  return qwen.updates.reduce<ChatMessage[]>((messages, update) => applyAcpUpdate(messages, update, ctx), []);
}

const reply = (extra: Record<string, unknown>) => ({ id: "m1", role: "agent", content: "", timestamp: 1, ...extra });
const tool = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, status: "completed", ...extra });

describe("a subagent's steps in a saved transcript", () => {
  it("keeps a subagent's steps across a load", () => {
    const messages = folded();

    expect(normalizeTranscript(JSON.parse(JSON.stringify(messages)))).toEqual(messages);
  });

  it("drops a malformed steps list and shows its tools", () => {
    const saved = reply({
      tools: [tool("p", { steps: [{ kind: "tools", toolIds: ["nope"] }], agentType: 4, thinking: {}, isTextCut: "yes" }), tool("c", { parentId: 7 })],
      parts: [{ kind: "tools", toolIds: ["p"] }],
    });

    const [message] = normalizeTranscript([saved]);

    expect(message.tools).toEqual([tool("p"), tool("c")]);
    expect(message.parts).toEqual([
      { kind: "tools", toolIds: ["p"] },
      { kind: "tools", toolIds: ["c"] },
    ]);
  });

  it("shows a child whose parent no longer lists it", () => {
    const saved = reply({
      tools: [tool("p", { steps: "gone" }), tool("c", { parentId: "p" })],
      parts: [{ kind: "tools", toolIds: ["p"] }],
    });

    const [message] = normalizeTranscript([saved]);

    expect(message.tools![1]).toEqual(tool("c"));
    expect(message.parts!.at(-1)).toEqual({ kind: "tools", toolIds: ["c"] });
  });

  it("loads a transcript saved before subagent steps unchanged", () => {
    const saved = reply({ content: "done", tools: [tool("a"), tool("b")], parts: [{ kind: "tools", toolIds: ["a", "b"] }, { kind: "text", text: "done" }] });

    expect(normalizeTranscript([saved])).toEqual([saved]);
  });
});
