import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskRow } from "../components/chat/TaskRow";
import { MessageRow, type MessageRowProps } from "../components/chat/MessageRow";
import type { SubagentTask, TaskStatus } from "../lib/task-view";
import type { ChatMessage, ToolExecution } from "../types";

const task = (extra: Partial<SubagentTask> = {}): SubagentTask => ({
  toolId: "p", title: "Explore the session list tests", agentType: "Explore", stepCount: 8, status: "Working", hasSteps: true, ...extra,
});

describe("TaskRow", () => {
  it.each<TaskStatus>(["Working", "Needs you", "Done", "Failed", "Did not finish"])("says %s in words", (status) => {
    render(<TaskRow task={task({ status })} secondLine="Explore · 8 steps" isOpen={false} onOpen={vi.fn()} />);

    expect(screen.getByText(status)).toBeInTheDocument();
  });

  it("is a button that opens its task when it has steps", () => {
    const onOpen = vi.fn();
    render(<TaskRow task={task()} secondLine="Explore · 8 steps" isOpen onOpen={onOpen} />);

    const row = screen.getByRole("button", { name: "Open Explore the session list tests. Working, 8 steps." });
    expect(row).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("is not a button without steps, and says the agent doesn't report them", () => {
    render(<TaskRow task={task({ hasSteps: false, stepCount: 0 })} secondLine="Codex doesn't report this subagent's steps" isOpen={false} onOpen={vi.fn()} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Codex doesn't report this subagent's steps")).toBeInTheDocument();
  });

  it("is not a button where nothing can open it", () => {
    render(<TaskRow task={task()} secondLine="Explore · 8 steps" isOpen={false} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows how long a working task has run", () => {
    render(<TaskRow task={task({ startedAt: Date.now() - 100_000 })} secondLine="x" isOpen={false} onOpen={vi.fn()} />);

    expect(screen.getByText(/^1m 4\ds$/)).toBeInTheDocument();
  });
});

const tool = (id: string, extra: Partial<ToolExecution> = {}): ToolExecution => ({ id, name: id, status: "completed", ...extra });
const reply: ChatMessage = {
  id: "m1", role: "agent", content: "", timestamp: 1,
  tools: [
    tool("r", { name: "Read notes.txt", kind: "read", locations: ["notes.txt"] }),
    tool("p", { name: "Explore the tests", agentType: "Explore", steps: [{ kind: "tools", toolIds: ["c1"] }] }),
    tool("c1", { name: "Read child.txt", kind: "read", locations: ["child.txt"], parentId: "p" }),
  ],
  parts: [{ kind: "tools", toolIds: ["r", "p"] }],
};

function renderMessage(extra: Partial<MessageRowProps> = {}) {
  const props: MessageRowProps = {
    message: reply, agentName: "Claude Code", isLast: true, isCurrentTurn: false, showActions: true,
    copied: false, speaking: false, readAloudSupported: false, onCopy: vi.fn(), onToggleReadAloud: vi.fn(), ...extra,
  };
  return render(<MessageRow {...props} />);
}

describe("a subagent in a reply", () => {
  it("draws a subagent as a task row that opens its task", () => {
    const onOpenTask = vi.fn();
    renderMessage({ onOpenTask });

    fireEvent.click(screen.getByRole("button", { name: "Open Explore the tests. Done, 1 step." }));

    expect(onOpenTask).toHaveBeenCalledWith("m1", "p");
    expect(screen.getByText("Explore · 1 step")).toBeInTheDocument();
  });

  it("counts only the reply's own tools in the summary", () => {
    renderMessage();

    expect(screen.getByRole("button", { name: "Read a file" })).toBeInTheDocument();
  });

  it("marks the row whose tab is open", () => {
    renderMessage({ onOpenTask: vi.fn(), openTaskId: "p" });

    expect(screen.getByRole("button", { name: /^Open Explore the tests/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("a reply saved without parts", () => {
  it("leaves a subagent's own tools out of the reply's list", () => {
    const { parts: _parts, ...withoutParts } = reply;
    renderMessage({ message: withoutParts });

    fireEvent.click(screen.getByRole("button", { name: "Read a file" }));

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByText("child.txt")).toBeNull();
  });
});
