import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AgentChipRow } from "../components/composer/AgentChipRow";
import { shownTiles } from "../lib/agent-tiles";
import type { AgentChoice } from "../lib/composer-controls";

/** The draft's agents as a row of chips at the top of the composer card, as the `CalmHome` artboard draws them. */
const choice = (value: string, name: string, extra: Partial<AgentChoice> = {}): AgentChoice => ({ value, label: name, name, ...extra });

const SIX = ["a", "b", "c", "d", "e", "f"].map((id) => ({ value: id }));
const ids = (tiles: readonly { value: string }[]) => tiles.map((tile) => tile.value).join("");

describe("shownTiles", () => {
  it("shows the first four agents in use, in their order", () => {
    expect(ids(shownTiles(SIX, ["a"]))).toBe("abcd");
    expect(ids(shownTiles(SIX.slice(0, 2), ["a"]))).toBe("ab");
    expect(ids(shownTiles([], []))).toBe("");
  });

  it("gives a chosen agent outside the four the place of the last tile that is not chosen", () => {
    expect(ids(shownTiles(SIX, ["e"]))).toBe("abce");
    expect(ids(shownTiles(SIX, ["a", "f"]))).toBe("abcf");
    // d is chosen, so c gives way.
    expect(ids(shownTiles(SIX, ["d", "e"]))).toBe("abed");
  });

  it("places several chosen agents from outside, each on a tile that is not chosen", () => {
    // e takes d's place, then f takes c's.
    expect(ids(shownTiles(SIX, ["a", "e", "f"]))).toBe("abfe");
  });

  it("changes nothing when all four tiles are chosen", () => {
    expect(ids(shownTiles(SIX, ["a", "b", "c", "d"]))).toBe("abcd");
  });
});

const OPTIONS: AgentChoice[] = [
  choice("claude-acp", "Claude Code", { signIn: "ready" }),
  choice("codex-acp", "Codex", { signIn: "ready" }),
  choice("gemini", "Gemini CLI", { signIn: "unchecked" }),
  choice("qwen-code", "Qwen Code", { signIn: "needed", blockedBy: "sign-in", disabledReason: "You need to sign in first." }),
  choice("pi", "Pi", { blockedBy: "install", disabledReason: "You need to install it first." }),
];

function renderRow(selected: string[], extra: Partial<Parameters<typeof AgentChipRow>[0]> = {}) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  render(
    <AgentChipRow options={OPTIONS} selected={selected} canTick isOpen={false} onToggle={vi.fn()} onChange={onChange} onPick={onPick} {...extra} />,
  );
  return { onChange, onPick };
}

const group = () => screen.getByRole("group", { name: "Agents for this task" });
const chip = (name: string | RegExp) => within(group()).getByRole("button", { name });

describe("the draft's agent chips", () => {
  it("is one row of chips with All agents as its last button, and no heading of its own", () => {
    renderRow(["claude-acp"]);
    expect(within(group()).queryByRole("heading")).toBeNull();
    const all = within(group()).getByRole("button", { name: "All agents" });
    expect(all).toHaveTextContent("");
    expect(all.querySelector("svg.lucide-plus")).not.toBeNull();
  });

  it("draws four chips, the fifth agent only under All agents", () => {
    renderRow(["claude-acp"]);
    expect(document.querySelectorAll("[data-agent-tile]")).toHaveLength(4);
    expect(document.querySelector('[data-agent-tile="pi"]')).toBeNull();
  });

  it("fills a picked chip, with its name at 500 and a check; an unpicked one has no fill", () => {
    renderRow(["claude-acp"]);
    const picked = chip("Claude Code");
    expect(picked).toHaveAttribute("aria-pressed", "true");
    expect(picked).toHaveClass("h-7", "bg-chip", "text-fg", "font-medium");
    expect(picked.querySelector("svg.lucide-check")).not.toBeNull();
    const idle = chip("Codex");
    expect(idle).toHaveAttribute("aria-pressed", "false");
    expect(idle).toHaveClass("text-fg-secondary");
    expect(idle.className).not.toContain("bg-chip");
    expect(idle.querySelector("svg.lucide-check")).toBeNull();
  });

  it("joins a picked agent's model picker to its chip, under one fill", () => {
    renderRow(["claude-acp", "codex-acp"], {
      modelOf: (agentId) => <button type="button">{agentId === "claude-acp" ? "Opus" : "gpt-5-codex"}</button>,
    });
    const claude = document.querySelector('[data-agent-group="claude-acp"]') as HTMLElement;
    expect(claude).toHaveClass("bg-chip", "rounded-md");
    expect(within(claude).getByRole("button", { name: "Claude Code" }).className).not.toContain("bg-chip");
    expect(within(claude).getByRole("button", { name: "Opus" })).toBeInTheDocument();
    expect(document.querySelector('[data-agent-group="gemini"]')).toBeNull();
  });

  it("ticks and unticks through the same call the list makes", () => {
    const { onChange, onPick } = renderRow(["claude-acp"]);
    fireEvent.click(chip("Codex"));
    expect(onChange).toHaveBeenCalledWith("codex-acp");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names a blocked chip by what it needs, says Sign in after its name, never ticks it, and picks it alone", () => {
    const { onChange, onPick } = renderRow(["claude-acp"], { modelOf: () => <button type="button">Model</button> });
    const blocked = chip("Qwen Code, sign in first");
    expect(blocked).not.toHaveAttribute("aria-pressed");
    expect(within(blocked).getByText("Sign in").previousElementSibling).toHaveClass("bg-status-attention");
    fireEvent.click(blocked);
    expect(onPick).toHaveBeenCalledWith("qwen-code");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picks alone while the only chosen agent is blocked, and draws no model for it", () => {
    const { onChange, onPick } = renderRow(["qwen-code"], { modelOf: () => <button type="button">Model</button> });
    expect(within(group()).queryByRole("button", { name: "Model" })).toBeNull();
    fireEvent.click(chip("Codex"));
    expect(onPick).toHaveBeenCalledWith("codex-acp");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds all four chips with the chosen agents once the run is full", () => {
    const six = [
      ...OPTIONS.slice(0, 3),
      choice("kimi", "Kimi CLI", { signIn: "ready" }),
      choice("glm", "GLM Agent", { signIn: "ready" }),
      choice("opencode", "OpenCode", { signIn: "ready" }),
    ];
    renderRow(["claude-acp", "codex-acp", "gemini", "opencode"], { options: six });
    expect(document.querySelectorAll('[data-agent-tile][aria-pressed="true"]')).toHaveLength(4);
    expect(document.querySelector('[data-agent-tile="kimi"]')).toBeNull();
  });

  it("where nothing can be ticked, a press picks that agent", () => {
    const { onChange, onPick } = renderRow(["claude-acp"], { canTick: false });
    expect(chip("Claude Code")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip("Codex"));
    expect(onPick).toHaveBeenCalledWith("codex-acp");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("while Private holds the row, every other chip and All agents stay but cannot be picked, with the reason", () => {
    const reason = "Private runs Qwen Code alone. Turn Private off to pick another agent.";
    const options = OPTIONS.map((option) => (option.value === "qwen-code" ? choice("qwen-code", "Qwen Code", { signIn: "ready" }) : option));
    const { onChange, onPick } = renderRow(["qwen-code"], { options, lockedTo: { agentId: "qwen-code", reason } });
    const codex = chip("Codex");
    expect(codex).toHaveAttribute("aria-disabled", "true");
    expect(codex).toHaveAttribute("title", reason);
    expect(codex).toHaveClass("cursor-not-allowed", "text-fg-subtle");
    fireEvent.click(codex);
    expect(onChange).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    expect(chip("Qwen Code")).not.toHaveAttribute("aria-disabled");
    const all = within(group()).getByRole("button", { name: "All agents" });
    expect(all).toHaveAttribute("aria-disabled", "true");
    expect(all).not.toHaveAttribute("aria-haspopup");
  });
});
