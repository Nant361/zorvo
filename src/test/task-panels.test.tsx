import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TasksPanel, type TasksPanelProps } from "../components/tasks/TasksPanel";
import { findShellTask, shellToolFor, type BackgroundTask } from "../lib/background-tasks";
import type { TaskTab, TaskTabs } from "../hooks/useTaskTabs";
import type { ChatMessage, ToolExecution } from "../types";

const tool = (id: string, extra: Partial<ToolExecution> = {}): ToolExecution => ({ id, name: id, status: "completed", ...extra });
const subagent = (extra: Partial<ToolExecution> = {}) =>
  tool("p", {
    name: "Explore the session list tests", agentType: "Explore", status: "running", startedAt: Date.now() - 100_000,
    steps: [{ kind: "tools", toolIds: ["c1"] }, { kind: "text", text: "Two test files cover the list." }],
    ...extra,
  });
const child = tool("c1", { name: "Read", kind: "read", locations: ["src/test/session-list.test.tsx"], parentId: "p" });
const dev = tool("sh", { name: "pnpm tauri dev", kind: "execute", command: "pnpm tauri dev", details: [{ kind: "text", text: "VITE ready in 412 ms" }] });
const messages = (p: ToolExecution): ChatMessage[] => [{ id: "m", role: "agent", content: "", timestamp: 1, tools: [p, child, dev] }];
const shellTask: BackgroundTask = {
  id: "process:77", kind: "shell", name: "pnpm tauri dev", detail: "Alpha · localhost:1420", status: "Running",
  startedAt: Date.now() - 724_000, sessionId: "s1", pid: 77,
};
const SUB: TaskTab = { kind: "subagent", toolId: "p" };
const SHELL: TaskTab = { kind: "shell", taskId: "process:77" };

function renderPanel(selected: TaskTab, over: Partial<TasksPanelProps> = {}, p = subagent()) {
  const tabs: TaskTabs = { tabs: [SUB, SHELL], selected, open: vi.fn(), select: vi.fn(), close: vi.fn() };
  const props: TasksPanelProps = {
    tabs, sessionId: "s1", messages: messages(p), tasks: [shellTask], agentName: "Claude Code", isBusy: true, onStop: vi.fn(async () => true), ...over,
  };
  render(<TasksPanel {...props} />);
  return props;
}

describe("the Tasks tab", () => {
  it("lists the open tasks as tabs and selects one", () => {
    const props = renderPanel(SUB);
    const strip = screen.getByRole("tablist", { name: "Open tasks" });

    expect(within(strip).getByRole("tab", { name: /Explore the session list tests/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(strip).getByRole("tab", { name: /pnpm tauri dev/ }));

    expect(props.tabs.select).toHaveBeenCalledWith(SHELL);
  });

  it("closes a tab by its button", () => {
    const props = renderPanel(SUB);

    fireEvent.click(screen.getByRole("button", { name: "Close pnpm tauri dev" }));

    expect(props.tabs.close).toHaveBeenCalledWith(SHELL);
  });

  it("says in words that a tab's task runs", () => {
    renderPanel(SUB);

    expect(within(screen.getByRole("tablist", { name: "Open tasks" })).getAllByText("Running", { selector: ".sr-only" })).toHaveLength(2);
  });

  it("shows a running subagent's steps and that it is working, with no Stop", () => {
    renderPanel(SUB);

    expect(screen.getByRole("heading", { name: "Explore the session list tests" })).toBeInTheDocument();
    expect(screen.getByText(/^Explore · subagent of Claude Code · started /)).toBeInTheDocument();
    expect(screen.getByText("session-list.test.tsx", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Two test files cover the list.")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Explore is working");
    expect(screen.getByText("Stop Claude Code to stop it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("shows what a finished subagent told the agent, and that it is the agent's report", () => {
    renderPanel(SUB, { isBusy: false }, subagent({ status: "completed" }));

    expect(screen.getByText("Explore · subagent of Claude Code · 1 step")).toBeInTheDocument();
    const told = screen.getByRole("region", { name: "What it told Claude Code" });
    expect(within(told).getByText("Two test files cover the list.")).toBeInTheDocument();
    expect(screen.getByText("This is Claude Code's own report of what its subagent did. Rewinding the chat removes it too.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows what the subagent's own tool call returned", () => {
    renderPanel(SUB, { isBusy: false }, subagent({ status: "completed", details: [{ kind: "text", text: "Final result from the tool." }] }));

    expect(screen.getByText("Final result from the tool.")).toBeInTheDocument();
  });

  it("says when a subagent's text was cut", () => {
    renderPanel(SUB, {}, subagent({ isTextCut: true }));

    expect(screen.getByText("The rest of its text was left out.")).toBeInTheDocument();
  });

  it("stops a shell command", () => {
    const props = renderPanel(SHELL);

    expect(screen.getByText("Shell · started by Claude Code")).toBeInTheDocument();
    expect(screen.getByText("localhost:1420")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop pnpm tauri dev" }));

    expect(props.onStop).toHaveBeenCalledWith(shellTask);
  });

  it("shows the output the agent reported and says it stopped reporting", () => {
    renderPanel(SHELL);

    expect(within(screen.getByLabelText("Command output")).getByText("VITE ready in 412 ms")).toBeInTheDocument();
    expect(screen.getByText("as Claude Code last reported it")).toBeInTheDocument();
    expect(
      screen.getByText("The command still runs. Claude Code stopped reporting its output when the tool call ended, so ask Claude Code for anything newer."),
    ).toBeInTheDocument();
  });

  it("shows no output block for a command with no reported output", () => {
    renderPanel(SHELL, { tasks: [{ ...shellTask, name: "python -m http.server" }] });

    expect(screen.queryByLabelText("Command output")).toBeNull();
  });

  it("spells out control characters in a command", () => {
    renderPanel(SHELL, { tasks: [{ ...shellTask, name: "echo a‮b" }] });

    expect(screen.getByRole("heading", { name: "echo a\\u202Eb" })).toBeInTheDocument();
  });
});

describe("finding a shell task and its tool call", () => {
  const transcripts = { s1: messages(subagent()) };

  it("finds the tool call whose command a process runs", () => {
    expect(shellToolFor(shellTask, transcripts.s1)?.id).toBe("sh");
    expect(shellToolFor({ ...shellTask, name: "cargo run" }, transcripts.s1)).toBeUndefined();
  });

  it("finds a tool row's own tool call", () => {
    expect(shellToolFor({ ...shellTask, id: "tool:s1:sh", pid: undefined }, transcripts.s1)?.id).toBe("sh");
  });

  it("follows a task from its tool row to the process that took its place", () => {
    expect(findShellTask([shellTask], "tool:s1:sh", transcripts)).toBe(shellTask);
    expect(findShellTask([shellTask], "process:77", transcripts)).toBe(shellTask);
    expect(findShellTask([shellTask], "process:1", transcripts)).toBeUndefined();
  });
});
