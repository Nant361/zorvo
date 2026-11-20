import { describe, expect, it } from "vitest";
import {
  agentFills,
  barParts,
  compactCommandOf,
  compactTokens,
  contextTotals,
  MAX_TURN_POINTS,
  parseBreakdown,
  percentText,
  transcriptChars,
  withTurnPoint,
  zorvoFills,
  type ContextBreakdown,
} from "../lib/context-usage";
import type { ChatMessage } from "../types";

const breakdown = (categories: ContextBreakdown["categories"]): ContextBreakdown => ({
  modelName: "qwen4-max",
  windowSize: 1_000_000,
  isEstimated: true,
  categories,
});

describe("contextTotals", () => {
  it("warns from 85% of the window", () => {
    expect(contextTotals({ used: 849, size: 1000 }).isNearlyFull).toBe(false);
    expect(contextTotals({ used: 850, size: 1000 }).isNearlyFull).toBe(true);
  });

  it("has no share or room left when the window's size is unknown", () => {
    expect(contextTotals({ used: 48_100, size: 0 })).toEqual({ used: 48_100, size: 0, percent: null, left: null, isNearlyFull: false });
  });

  it("never counts room below zero", () => {
    expect(contextTotals({ used: 1200, size: 1000 })).toMatchObject({ percent: 100, left: 0 });
  });
});

describe("barParts", () => {
  it("splits the window into used, free and the agent's buffer", () => {
    expect(barParts(contextTotals({ used: 577_000, size: 1_000_000 }), 150_000)).toEqual({ used: 577_000, free: 273_000, buffer: 150_000 });
  });

  it("shrinks the buffer when the used part reaches into it", () => {
    expect(barParts(contextTotals({ used: 950, size: 1000 }), 150)).toEqual({ used: 950, free: 0, buffer: 50 });
  });

  it("has no bar without the window's size", () => {
    expect(barParts(contextTotals({ used: 10, size: 0 }), 0)).toBeNull();
  });
});

describe("zorvoFills", () => {
  it("counts four characters a token and puts the rest in one row", () => {
    const rows = zorvoFills(10_000, 4_000, [
      { path: "CLAUDE.md", bytes: 400 },
      { path: "~/.claude/CLAUDE.md", bytes: 200 },
    ]);
    expect(rows.map((r) => [r.label, r.tokens])).toEqual([
      ["Messages", 1000],
      ["Instruction files", 150],
      ["Everything else", 8850],
    ]);
    expect(rows[1].items).toEqual([
      { name: "CLAUDE.md", tokens: 100 },
      { name: "~/.claude/CLAUDE.md", tokens: 50 },
    ]);
    expect(rows.every((r) => r.isEstimate)).toBe(true);
  });

  it("leaves out instruction files when there are none, and never goes below zero", () => {
    const rows = zorvoFills(100, 4_000, []);
    expect(rows.map((r) => [r.label, r.tokens])).toEqual([
      ["Messages", 1000],
      ["Everything else", 0],
    ]);
  });
});

describe("transcriptChars", () => {
  it("counts messages, reasoning, commands and the tools' text, not diffs", () => {
    const messages = [
      { id: "1", role: "user", content: "abcd", timestamp: 0 },
      {
        id: "2",
        role: "agent",
        content: "ef",
        thinking: "ghi",
        timestamp: 0,
        tools: [
          {
            id: "t",
            name: "run",
            status: "completed",
            command: "ls",
            details: [
              { kind: "text", text: "12345" },
              { kind: "changed", path: "a.ts" },
            ],
          },
        ],
      },
    ] as unknown as ChatMessage[];
    expect(transcriptChars(messages)).toBe(4 + 2 + 3 + 2 + 5);
  });
});

describe("agentFills", () => {
  it("leaves out free space, the buffer and empty categories, but keeps messages", () => {
    const rows = agentFills(
      breakdown([
        { key: "systemPrompt", tokens: 4494, items: [], more: 0 },
        { key: "mcpTools", tokens: 0, items: [], more: 0 },
        { key: "skills", tokens: 42_331, items: [{ name: "testing", tokens: 113 }], more: 390 },
        { key: "messages", tokens: 0, items: [], more: 0 },
        { key: "freeSpace", tokens: 782_147, items: [], more: 0 },
        { key: "autocompactBuffer", tokens: 150_000, items: [], more: 0 },
      ]),
    );
    expect(rows.map((r) => r.label)).toEqual(["System prompt", "Skills", "Messages"]);
    expect(rows[1]).toMatchObject({ more: 390, isEstimate: false });
  });
});

describe("parseBreakdown", () => {
  it("reads what the backend returns", () => {
    const raw = { modelName: "qwen4-max", windowSize: 1_000_000, isEstimated: true, categories: [{ key: "skills", tokens: 5, items: [{ name: "a", tokens: 5 }], more: 0 }] };
    expect(parseBreakdown(raw)).toEqual(raw);
  });

  it("refuses an unknown category or a bad number", () => {
    const base = { modelName: null, windowSize: 1, isEstimated: false };
    expect(parseBreakdown({ ...base, categories: [{ key: "cachedTokens", tokens: 1, items: [], more: 0 }] })).toBeNull();
    expect(parseBreakdown({ ...base, categories: [{ key: "skills", tokens: -1, items: [], more: 0 }] })).toBeNull();
    expect(parseBreakdown({ ...base, categories: [{ key: "skills", tokens: 1, items: [{ name: 3 }], more: 0 }] })).toBeNull();
    expect(parseBreakdown("nope")).toBeNull();
  });
});

describe("compactCommandOf", () => {
  it("offers compact before compress, and nothing without either", () => {
    expect(compactCommandOf([{ name: "compress", description: "" }, { name: "compact", description: "" }])).toBe("compact");
    expect(compactCommandOf([{ name: "/compress", description: "" }])).toBe("compress");
    expect(compactCommandOf([{ name: "init", description: "" }])).toBeNull();
  });
});

describe("withTurnPoint", () => {
  it("keeps the last points only", () => {
    let points: number[] | undefined;
    for (let i = 1; i <= MAX_TURN_POINTS + 3; i++) points = withTurnPoint(points, i);
    expect(points).toHaveLength(MAX_TURN_POINTS);
    expect(points?.[0]).toBe(4);
  });
});

describe("formatting", () => {
  it("writes tokens and shares short", () => {
    expect(compactTokens(577_000)).toBe("577k");
    expect(compactTokens(1_000_000)).toBe("1M");
    expect(compactTokens(48_100)).toBe("48.1k");
    expect(percentText(57.73)).toBe("57.7%");
    expect(percentText(91)).toBe("91%");
  });
});
