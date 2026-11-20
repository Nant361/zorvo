import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import type { CompareModelControl } from "../lib/compare-models";

/** A compare draft's agent chips: each picked agent's model picker joined to its chip. */
const opus: CompareModelControl = {
  profileId: "claude-acp",
  name: "Claude Code",
  state: "known",
  control: { options: [{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }], selected: "opus", onChange: vi.fn() },
};
const codex = (state: CompareModelControl["state"]): CompareModelControl => ({ profileId: "codex", name: "Codex", state });

function renderDock(compareModels: CompareModelControl[], onOpenCompareModel = vi.fn()) {
  const options = compareModels.map((entry) => ({ value: entry.profileId, label: entry.name, name: entry.name }));
  render(
    <ComposerDock
      onSendMessage={() => {}}
      onAttach={async () => []}
      compareModels={compareModels}
      onOpenCompareModel={onOpenCompareModel}
      agents={{ options, selected: options.map((option) => option.value), canTick: true, onChange: vi.fn(), onPick: vi.fn() }}
    />,
  );
  return onOpenCompareModel;
}

describe("a compare draft's model chips", () => {
  it("joins one model picker per picked agent to its chip, none in the bottom row", () => {
    renderDock([opus, codex("unknown")]);
    const claude = screen.getByRole("button", { name: "Claude Code model: Opus" });
    const codexChip = screen.getByRole("button", { name: "Codex model: Default" });
    expect(claude.closest('[data-agent-group="claude-acp"]')).not.toBeNull();
    expect(codexChip.closest('[data-agent-group="codex"]')).not.toBeNull();
    expect(claude.closest("[data-composer-row]")).toBeNull();
    expect(claude).toHaveClass("border-l", "rounded-l-none");
  });

  it("asks an unknown agent when its chip opens", () => {
    const onOpen = renderDock([opus, codex("unknown")]);
    const chip = screen.getByRole("button", { name: "Codex model: Default" });
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith("codex");
    expect(chip.closest("div.relative")!.querySelector("[role=listbox]")).toHaveClass("top-full");
  });

  it("shows the skeleton only while the agent is being asked", () => {
    renderDock([codex("asking")]);
    fireEvent.click(screen.getByRole("button", { name: "Codex model: Default" }));
    expect(screen.getByText("Asking Codex for its models…")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-skeleton-row]")).toHaveLength(3);
  });

  it("says so when the agent offers no model choice, instead of asking for ever", () => {
    renderDock([codex("none")]);
    fireEvent.click(screen.getByRole("button", { name: "Codex model: Default" }));
    expect(screen.getByText("Codex does not offer a model choice. It starts on its default.")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-skeleton-row]")).toHaveLength(0);
    expect(screen.queryByText(/Asking Codex/)).toBeNull();
  });

  it("offers Try again when asking failed", () => {
    const onOpen = renderDock([codex("failed")]);
    fireEvent.click(screen.getByRole("button", { name: "Codex model: Default" }));
    expect(screen.getByText("Could not ask Codex for its models.")).toBeInTheDocument();
    onOpen.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onOpen).toHaveBeenCalledWith("codex");
  });

  it("asks nothing when a known chip opens", () => {
    const onOpen = renderDock([opus]);
    fireEvent.click(screen.getByRole("button", { name: "Claude Code model: Opus" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Opus" })).toBeInTheDocument();
  });

  it("searches a long list like the single draft's", () => {
    const many: CompareModelControl = {
      ...opus,
      control: {
        options: Array.from({ length: 12 }, (_, n) => ({ value: `m${n}`, label: `Model ${n}` })),
        selected: "m0",
        onChange: vi.fn(),
      },
    };
    renderDock([many]);
    fireEvent.click(screen.getByRole("button", { name: "Claude Code model: Model 0" }));
    expect(screen.getByRole("searchbox", { name: "Search claude code model" })).toBeInTheDocument();
  });
});
