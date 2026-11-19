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

  it("follows a running subagent's new steps only until you scroll up", () => {
    const tabs: TaskTabs = { tabs: [SUB], selected: SUB, open: vi.fn(), select: vi.fn(), close: vi.fn() };
    const props = (p: ToolExecution): TasksPanelProps => ({
      tabs, sessionId: "s1", messages: messages(p), tasks: [], agentName: "Claude Code", isBusy: true, onStop: vi.fn(async () => true),
    });
    const { rerender } = render(<TasksPanel {...props(subagent())} />);
    const scroller = screen.getByTestId("subagent-steps");
    Object.defineProperties(scroller, { scrollHeight: { value: 900, configurable: true }, clientHeight: { value: 300, configurable: true } });

    rerender(<TasksPanel {...props(subagent({ thinking: "more" }))} />);
    expect(scroller.scrollTop).toBe(900);

    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    rerender(<TasksPanel {...props(subagent({ thinking: "even more" }))} />);

    expect(scroller.scrollTop).toBe(100);
  });

  it("says a subagent needs your answer when its request sits in a later reply", () => {
    const first = messages(subagent())[0];
    const asking: ChatMessage = {
      id: "m2", role: "agent", content: "", timestamp: 2,
      actionCard: { id: "a", sessionId: "s1", title: "t", prompt: "", status: "pending", timestamp: 2, toolCallId: "c1" },
    };
    renderPanel(SUB, { messages: [first, asking] });

    expect(screen.getByRole("status")).toHaveTextContent("Explore needs your answer in the chat");
  });

  it("does not call a subagent of an earlier turn working while a new turn runs", () => {
    const first = messages(subagent())[0];
    const next: ChatMessage = { id: "u2", role: "user", content: "next", timestamp: 3 };
    renderPanel(SUB, { messages: [first, next], isBusy: true });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the lines of a command's output apart", () => {
    const twoLines = { ...dev, details: [{ kind: "text" as const, text: "VITE ready\r\nLocal: http://localhost:1420/\u202E" }] };
    renderPanel(SHELL, { messages: [{ id: "m", role: "agent", content: "", timestamp: 1, tools: [twoLines] }] });

    expect(screen.getByLabelText("Command output").textContent).toBe("VITE ready\nLocal: http://localhost:1420/\\u202E");
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

  const NOW = 1_000_000;
  const launch = (id: string, command: string, startedAt: number, extra: Partial<ToolExecution> = {}) =>
    tool(id, { name: `Run ${command}`, kind: "execute", command, startedAt, ...extra });
  const process = (command: string, startedAt: number): BackgroundTask => ({ ...shellTask, name: command, startedAt });
  const one = (...tools: ToolExecution[]): ChatMessage[] => [{ id: "m", role: "agent", content: "", timestamp: 1, tools }];

  it("keeps a process with its own launch when the same command runs again", () => {
    const first = launch("first", "pnpm dev", NOW - 60_000, { status: "running", details: [{ kind: "text", text: "ready" }] });
    const again = launch("again", "pnpm dev", NOW - 5_000, { status: "failed", details: [{ kind: "text", text: "port in use" }] });

    expect(shellToolFor(process("pnpm dev", NOW - 59_500), one(first, again))?.id).toBe("first");
  });

  it("never matches a launch that started after the process", () => {
    const later = launch("later", "pnpm dev", NOW);

    expect(shellToolFor(process("pnpm dev", NOW - 60_000), one(later))).toBeUndefined();
  });

  it("does not match a short command inside a longer one", () => {
    const watch = launch("watch", "node scripts/watch.mjs", NOW - 60_000);

    expect(shellToolFor(process("node", NOW - 59_000), one(watch))).toBeUndefined();
    expect(shellToolFor(process("node scripts/watch.mjs --poll", NOW - 59_000), one(watch))).toBeUndefined();
  });

  it("matches a command the scan cut short", () => {
    const long = launch("long", `pnpm vitest run ${"a".repeat(400)}`, NOW - 60_000);

    expect(shellToolFor(process(`pnpm vitest run ${"a".repeat(283)}…`, NOW - 59_000), one(long))?.id).toBe("long");
  });

  it("matches a launch given as a shell invocation, as the scan shows only its script", () => {
    const wrapped = launch("wrapped", `bash -lc "pnpm dev"`, NOW - 60_000);
    const zsh = launch("zsh", "/bin/zsh -l -c 'cargo watch -x test'", NOW - 60_000);

    expect(shellToolFor(process("pnpm dev", NOW - 59_000), one(wrapped))?.id).toBe("wrapped");
    expect(shellToolFor(process("cargo watch -x test", NOW - 59_000), one(zsh))?.id).toBe("zsh");
    expect(shellToolFor(process("bash -lc", NOW - 59_000), one(wrapped))).toBeUndefined();
  });

  it("matches a launch whose program replaced its shell under its interpreter", () => {
    const unit = launch("unit", "pnpm test:unit", NOW - 60_000);
    const py = launch("py", "./serve.py --port 8000", NOW - 60_000);

    expect(shellToolFor(process("node /app/pnpm test:unit", NOW - 59_000), one(unit))?.id).toBe("unit");
    expect(shellToolFor(process("/usr/bin/python3 /work/serve.py --port 8000", NOW - 59_000), one(py))?.id).toBe("py");
    expect(shellToolFor(process("node /app/pnpm test:e2e", NOW - 59_000), one(unit))).toBeUndefined();
    expect(shellToolFor(process("node /app/other-pnpm test:unit", NOW - 59_000), one(unit))).toBeUndefined();
  });

  it("matches a non-shell program run with -c, which the scan shows as its script", () => {
    const sleep = launch("sleep", `python3 -c "import time; time.sleep(300)"`, NOW - 60_000);

    expect(shellToolFor(process("import time; time.sleep(300)", NOW - 59_000), one(sleep))?.id).toBe("sleep");
  });

  it("matches a -c command the scan shows whole, as it does inside an agent's eval wrapper", () => {
    const sleep = launch("sleep", `python3 -c "import time; time.sleep(300)"`, NOW - 60_000);

    expect(shellToolFor(process(`python3 -c "import time; time.sleep(300)"`, NOW - 59_000), one(sleep))?.id).toBe("sleep");
  });

  it("matches a launch that sets variables before its command", () => {
    const tagged = launch("tagged", "TAG=demo PORT=3001 sleep 300", NOW - 60_000);
    const served = launch("served", "PORT=3001 pnpm dev", NOW - 60_000);

    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(tagged))?.id).toBe("tagged");
    expect(shellToolFor(process("node /app/pnpm dev", NOW - 59_000), one(served))?.id).toBe("served");
    expect(shellToolFor(process("TAG=demo PORT=3001 sleep 300", NOW - 59_000), one(tagged))?.id).toBe("tagged");
  });

  it("matches the last command of a list, which the shell replaced itself with", () => {
    const moved = launch("moved", "cd /tmp && sleep 300", NOW - 60_000);
    const listed = launch("listed", "export PORT=3001; pnpm dev", NOW - 60_000);

    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(moved))?.id).toBe("moved");
    expect(shellToolFor(process("node /app/pnpm dev", NOW - 59_000), one(listed))?.id).toBe("listed");
    expect(shellToolFor(process("cd /tmp", NOW - 59_000), one(moved))).toBeUndefined();
    expect(shellToolFor(process("pnpm dev", NOW - 59_000), one(launch("wrapped", `bash -lc "cd web && pnpm dev"`, NOW - 60_000)))?.id).toBe("wrapped");
  });

  it("matches a list that ends with its terminator, and a command run with exec", () => {
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("ended", "cd /tmp && sleep 300;", NOW - 60_000)))?.id).toBe("ended");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("exec", "exec sleep 300", NOW - 60_000)))?.id).toBe("exec");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("both", "cd /tmp && exec sleep 300", NOW - 60_000)))?.id).toBe("both");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("or", "test -d /nope || sleep 300", NOW - 60_000)))?.id).toBe("or");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("c", "exec sleep 300 # keep alive", NOW - 60_000)))?.id).toBe("c");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("cl", "# start it\ncd /tmp # here\nsleep 300", NOW - 60_000)))?.id).toBe("cl");
    expect(shellToolFor(process("curl http://x/#top", NOW - 59_000), one(launch("h", "curl http://x/#top", NOW - 60_000)))?.id).toBe("h");
    const quoted = `python3 -c 'import time; print("hello # world"); time.sleep(300)'`;
    expect(shellToolFor(process(quoted, NOW - 59_000), one(launch("q", quoted, NOW - 60_000)))?.id).toBe("q");
    expect(shellToolFor(process(`import time; print("hello # world"); time.sleep(300)`, NOW - 59_000), one(launch("q", quoted, NOW - 60_000)))?.id).toBe("q");
    expect(shellToolFor(process(`echo "a # b"`, NOW - 59_000), one(launch("d", `echo "a # b" # note`, NOW - 60_000)))?.id).toBe("d");
    expect(shellToolFor(process("sleep 300 # keep alive", NOW - 59_000), one(launch("w", "sleep 300 # keep alive", NOW - 60_000)))?.id).toBe("w");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("v", `TAG="hello world" sleep 300`, NOW - 60_000)))?.id).toBe("v");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("r", `exec sleep 300 > "/tmp/my log"`, NOW - 60_000)))?.id).toBe("r");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(launch("e", "sleep 300 2>/tmp/my\\ log", NOW - 60_000)))?.id).toBe("e");
    expect(shellToolFor(process("sleep 300", NOW - 59_000), one(tool("n", { name: "sleep 300", kind: "execute", startedAt: NOW - 60_000 })))?.id).toBe("n");
  });

  it("matches a launch that redirects its output or runs in the background", () => {
    const at = (command: string) => shellToolFor(process("sleep 300", NOW - 59_000), one(launch("x", command, NOW - 60_000)))?.id;

    expect(at("exec sleep 300 > /dev/null 2>&1")).toBe("x");
    expect(at("sleep 300 >>out.log 2>/dev/null < /dev/null")).toBe("x");
    expect(at("cd /tmp && sleep 300 &> log.txt &")).toBe("x");
    expect(at("sleep 3000 > /dev/null")).toBeUndefined();
    expect(at("cd /tmp\nsleep 300")).toBe("x");
    expect(shellToolFor(process("tail -f /dev/null", NOW - 59_000), one(launch("t", "exec tail -f /dev/null>/dev/null 2>&1", NOW - 60_000)))?.id).toBe("t");
    expect(at("cd /tmp\r\n  sleep   300\n")).toBe("x");
  });

  it("keeps two scripts of one name apart when the launch names its path", () => {
    const a = launch("a", "/workspace/a/serve.py --port 8000", NOW - 60_000);
    const rel = launch("rel", "scripts/serve.py --port 8000", NOW - 60_000);

    expect(shellToolFor(process("python3 /workspace/b/serve.py --port 8000", NOW - 59_000), one(a))).toBeUndefined();
    expect(shellToolFor(process("python3 /workspace/a/serve.py --port 8000", NOW - 59_000), one(a))?.id).toBe("a");
    expect(shellToolFor(process("python3 /work/scripts/serve.py --port 8000", NOW - 59_000), one(rel))?.id).toBe("rel");
    expect(shellToolFor(process("python3 /work/other/serve.py --port 8000", NOW - 59_000), one(rel))).toBeUndefined();
  });

  it("keeps the first launch when a retry that failed started within the scan's rounding", () => {
    const first = launch("first", "pnpm dev", 100_000, { status: "completed" });
    const retry = launch("retry", "pnpm dev", 101_500, { status: "failed" });

    expect(shellToolFor(process("pnpm dev", 101_600), one(first, retry))?.id).toBe("first");
  });

  it("matches no launch the scan says started later than the process", () => {
    const late = launch("late", "pnpm dev", NOW + 1);

    expect(shellToolFor(process("pnpm dev", NOW), one(late))).toBeUndefined();
  });

  it("follows a tab from the first launch's row to its process after a second launch", () => {
    const first = launch("first", "pnpm dev", NOW - 60_000);
    const again = launch("again", "pnpm dev", NOW - 5_000, { status: "failed" });
    const server = process("pnpm dev", NOW - 59_500);

    expect(findShellTask([server], "tool:s1:first", { s1: one(first, again) })).toBe(server);
    expect(findShellTask([server], "tool:s1:again", { s1: one(first, again) })).toBeUndefined();
  });

  it("follows a task from its tool row to the process that took its place", () => {
    expect(findShellTask([shellTask], "tool:s1:sh", transcripts)).toBe(shellTask);
    expect(findShellTask([shellTask], "process:77", transcripts)).toBe(shellTask);
    expect(findShellTask([shellTask], "process:1", transcripts)).toBeUndefined();
  });
});
