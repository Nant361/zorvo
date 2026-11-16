import { describe, expect, it } from "vitest";
import { isTaskTool, secondLine, shownTools, stepsOf, subagentTaskOf, type SubagentTask } from "../lib/task-view";
import type { ActionCard, ChatMessage, ToolExecution } from "../types";

const tool = (id: string, extra: Partial<ToolExecution> = {}): ToolExecution => ({ id, name: id, status: "completed", ...extra });
const parent = (extra: Partial<ToolExecution> = {}) =>
  tool("p", {
    name: "Explore the tests",
    agentType: "Explore",
    startedAt: 5,
    steps: [{ kind: "tools", toolIds: ["c1", "c2"] }, { kind: "text", text: "First." }, { kind: "text", text: "Last." }],
    ...extra,
  });
const children = [tool("c1", { parentId: "p" }), tool("c2", { parentId: "p" })];
const message = (tools: ToolExecution[], actionCard?: Partial<ActionCard>): ChatMessage => ({
  id: "m", role: "agent", content: "", timestamp: 1, tools,
  ...(actionCard ? { actionCard: { id: "a", sessionId: "s", title: "t", prompt: "", status: "pending", timestamp: 1, ...actionCard } } : {}),
});
const taskOf = (p: ToolExecution, isTurnOver = false, card?: Partial<ActionCard>) =>
  subagentTaskOf(p, message([p, ...children], card), { isTurnOver });

describe("the task view", () => {
  it("leaves a subagent's own tools out of the shown tools", () => {
    expect(shownTools([parent(), ...children, tool("x")]).map((t) => t.id)).toEqual(["p", "x"]);
  });

  it("treats a tool with steps, or one named like a subagent, as a task", () => {
    expect(isTaskTool(parent())).toBe(true);
    expect(isTaskTool(tool("t", { providerToolName: "Task" }))).toBe(true);
    expect(isTaskTool(tool("r", { kind: "read" }))).toBe(false);
  });

  it("reads Done for a completed subagent, with its facts", () => {
    expect(taskOf(parent())).toEqual<SubagentTask>({
      toolId: "p", title: "Explore the tests", agentType: "Explore", stepCount: 2,
      status: "Done", startedAt: 5, hasSteps: true, lastText: "Last.",
    });
  });

  it("reads Failed for a failed subagent", () => {
    expect(taskOf(parent({ status: "failed" })).status).toBe("Failed");
  });

  it("reads Working while it runs in a turn", () => {
    expect(taskOf(parent({ status: "running" })).status).toBe("Working");
  });

  it("reads Did not finish when the turn ended while it ran", () => {
    expect(taskOf(parent({ status: "running" }), true).status).toBe("Did not finish");
  });

  it("reads Needs you while its child waits for a permission", () => {
    expect(taskOf(parent({ status: "running" }), false, { toolCallId: "c2" }).status).toBe("Needs you");
  });

  it("stays Working for a request that is answered or is not its child's", () => {
    expect(taskOf(parent({ status: "running" }), false, { toolCallId: "c2", status: "approved" }).status).toBe("Working");
    expect(taskOf(parent({ status: "running" }), false, { toolCallId: "other" }).status).toBe("Working");
  });

  it("has no tab for a subagent whose agent marks no steps", () => {
    const bare = tool("t", { providerToolName: "Task", status: "running" });

    expect(subagentTaskOf(bare, message([bare]), { isTurnOver: false })).toMatchObject({ hasSteps: false, stepCount: 0 });
  });

  it("words the second line", () => {
    const task = taskOf(parent());
    expect(secondLine(task, "Codex")).toBe("Explore · 2 steps");
    expect(secondLine({ ...task, agentType: undefined }, "Codex")).toBe("2 steps");
    expect(secondLine({ ...task, stepCount: 1 }, "Codex")).toBe("Explore · 1 step");
    expect(secondLine({ ...task, hasSteps: false }, "Codex")).toBe("Codex doesn't report this subagent's steps");
  });

  it("returns a subagent's steps with its child tools in order", () => {
    const p = parent();
    const steps = stepsOf(p, message([children[1], p, children[0]]));

    expect(steps.parts).toEqual(p.steps);
    expect(steps.tools.map((t) => t.id)).toEqual(["c1", "c2"]);
  });
});
