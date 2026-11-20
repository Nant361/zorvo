import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ContextPanel, type ContextPanelProps } from "../components/context/ContextPanel";
import { ContextMeter } from "../components/composer/ContextMeter";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const QWEN_BREAKDOWN = {
  modelName: "qwen4-max",
  windowSize: 1_000_000,
  isEstimated: true,
  categories: [
    { key: "systemPrompt", tokens: 4_900, items: [], more: 0 },
    { key: "instructionFiles", tokens: 13_000, items: [{ name: "QWEN.md", tokens: 8_900 }, { name: "~/.qwen/QWEN.md", tokens: 4_100 }], more: 0 },
    { key: "skills", tokens: 73_600, items: [{ name: "testing", tokens: 113 }], more: 12 },
    { key: "messages", tokens: 398_200, items: [], more: 0 },
    { key: "freeSpace", tokens: 273_000, items: [], more: 0 },
    { key: "autocompactBuffer", tokens: 150_000, items: [], more: 0 },
  ],
};

function answer(byCommand: Record<string, unknown>) {
  return vi.spyOn(internals(), "invoke").mockImplementation((cmd) =>
    cmd in byCommand ? Promise.resolve(byCommand[cmd]) : Promise.reject(new Error(`unexpected ${cmd}`)),
  );
}

function baseProps(): ContextPanelProps {
  return {
    sessionId: "s1",
    agentId: "qwen-code",
    agentName: "Qwen Code",
    cwd: "/w/project",
    usage: { used: 577_000, size: 1_000_000 },
    turnUsage: [],
    turnsEnded: 0,
    messages: [],
    compactCommand: null,
    isBusy: false,
    onCompact: vi.fn(),
  };
}

function renderPanel(overrides: Partial<ContextPanelProps> = {}) {
  const props: ContextPanelProps = { ...baseProps(), ...overrides };
  render(<ContextPanel {...props} />);
  return props;
}

afterEach(() => vi.restoreAllMocks());

describe("ContextPanel with Qwen Code's own breakdown", () => {
  it("shows the total, the buffer and what fills the window, as Qwen Code reports it", async () => {
    const invoke = answer({ acp_context_usage: QWEN_BREAKDOWN });
    renderPanel();

    expect(await screen.findByText("Estimated by Qwen Code")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("acp_context_usage", { sessionId: "s1" }, undefined);
    expect(invoke).not.toHaveBeenCalledWith("instruction_files", expect.anything(), undefined);
    expect(screen.getByText("57.7%")).toBeTruthy();
    expect(screen.getByText("Qwen Code · qwen4-max")).toBeTruthy();
    expect(screen.getByText("423k left before the window is full")).toBeTruthy();
    expect(screen.getByText("Autocompact buffer").nextSibling?.textContent).toContain("150,000");
    expect(screen.getByText("Free").nextSibling?.textContent).toContain("273,000");
    expect(screen.queryByText(/reports only the total/)).toBeNull();
  });

  it("opens a category to list what is in it", async () => {
    answer({ acp_context_usage: QWEN_BREAKDOWN });
    renderPanel();
    const skills = await screen.findByRole("button", { name: /Skills/ });

    fireEvent.click(skills);

    expect(skills.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("testing")).toBeTruthy();
    expect(screen.getByText("and 12 more")).toBeTruthy();
  });

  it("asks again on Refresh", async () => {
    const invoke = answer({ acp_context_usage: QWEN_BREAKDOWN });
    renderPanel();
    await screen.findByText("Estimated by Qwen Code");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await vi.waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "acp_context_usage")).toHaveLength(2));
  });

  it("asks again at every turn end, after the turn history stopped growing", async () => {
    const invoke = answer({ acp_context_usage: QWEN_BREAKDOWN });
    const full = Array.from({ length: 24 }, (_, i) => (i + 1) * 1000);
    const props = { ...baseProps(), turnUsage: full, turnsEnded: 30 };
    const { rerender } = render(<ContextPanel {...props} />);
    await screen.findByText("Estimated by Qwen Code");

    rerender(<ContextPanel {...props} turnUsage={[...full.slice(1), 25_000]} turnsEnded={31} />);

    await vi.waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "acp_context_usage")).toHaveLength(2));
  });

  it("falls back to Zorvo's estimate when Qwen Code's answer fails", async () => {
    answer({ instruction_files: [{ path: "QWEN.md", bytes: 400 }] });
    renderPanel();

    expect(await screen.findByText("Estimated by Zorvo")).toBeTruthy();
    expect(screen.getByText(/Qwen Code reports only the total/)).toBeTruthy();
  });
});

describe("ContextPanel with Zorvo's estimate", () => {
  it("counts the chat and the instruction files, and marks every value with ~", async () => {
    const invoke = answer({ instruction_files: [{ path: "CLAUDE.md", bytes: 4_000 }] });
    renderPanel({
      agentId: "claude-acp",
      agentName: "Claude Code",
      usage: { used: 182_040, size: 200_000, cost: { amount: 4.12, currency: "USD" } },
      messages: [{ id: "m", role: "user", content: "x".repeat(40_000), timestamp: 0 }],
    });

    expect(await screen.findByText("Estimated by Zorvo")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("instruction_files", { root: "/w/project", agentId: "claude-acp" }, undefined);
    expect(invoke).not.toHaveBeenCalledWith("acp_context_usage", expect.anything(), undefined);
    const fills = screen.getByRole("list");
    expect(within(fills).getByText("~10k")).toBeTruthy();
    expect(await within(fills).findByText("~1k")).toBeTruthy();
    expect(within(fills).getByText("Everything else")).toBeTruthy();
    expect(screen.getByText("Session cost").nextSibling?.textContent).toContain("$4.12");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("warns from 85% that the agent may summarize on its own", async () => {
    answer({ instruction_files: [] });
    renderPanel({ agentId: "claude-acp", agentName: "Claude Code", usage: { used: 182_040, size: 200_000 } });

    expect(await screen.findByText(/The window is nearly full\. Claude Code may summarize older messages on its own\./)).toBeTruthy();
    expect(screen.queryByText(/left before the window is full/)).toBeNull();
  });

  it("says so when the agent does not report its window's size, with no breakdown", async () => {
    answer({ instruction_files: [] });
    renderPanel({ agentId: "antigravity-acp", agentName: "Antigravity", usage: { used: 48_100, size: 0 } });

    expect(await screen.findByText(/Antigravity does not say how big its window is/)).toBeTruthy();
    expect(screen.getByText("48.1k")).toBeTruthy();
    expect(screen.queryByText("What fills it")).toBeNull();
  });
});

describe("ContextPanel's Compact button", () => {
  it("shows only with the agent's command, and sends it", async () => {
    answer({ instruction_files: [] });
    const props = renderPanel({ agentId: "claude-acp", agentName: "Claude Code", compactCommand: "compact" });

    fireEvent.click(await screen.findByRole("button", { name: "Compact context" }));

    expect(props.onCompact).toHaveBeenCalledWith("compact");
    expect(screen.getByText("Compact context sends /compact to Claude Code.")).toBeTruthy();
  });

  it("is absent without the command, and waits while a turn runs", async () => {
    answer({ instruction_files: [] });
    renderPanel({ agentId: "claude-acp", agentName: "Claude Code" });
    await screen.findByText("Estimated by Zorvo");
    expect(screen.queryByRole("button", { name: /context$/ })).toBeNull();
  });

  it("is disabled while a turn runs", async () => {
    answer({ acp_context_usage: QWEN_BREAKDOWN });
    renderPanel({ compactCommand: "compress", isBusy: true });

    expect((await screen.findByRole<HTMLButtonElement>("button", { name: "Compress context" })).disabled).toBe(true);
  });
});

describe("ContextPanel's turn chart", () => {
  it("draws one bar per turn end, named for screen readers", async () => {
    answer({ acp_context_usage: QWEN_BREAKDOWN });
    renderPanel({ turnUsage: [10_000, 25_000] });

    expect(await screen.findByRole("img", { name: /oldest first: 10k, 25k tokens/ })).toBeTruthy();
  });
});

describe("ContextMeter", () => {
  it("opens the Context tab when it can", async () => {
    const onOpen = vi.fn();
    render(<ContextMeter used={500} size={1000} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Open the context panel" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps its popover where there is no inspector", async () => {
    render(<ContextMeter used={500} size={1000} />);

    fireEvent.click(screen.getByRole("button", { name: "Context details" }));

    expect(screen.getByRole("dialog", { name: "Context usage" })).toBeTruthy();
  });
});
