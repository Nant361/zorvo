import type { ChatMessage, ContextUsage, SlashCommand } from "../types";

/** From this share of the window the panel warns that the agent may summarize on its own. */
export const NEARLY_FULL_AT = 85;
/** How many turn ends the "After each turn" chart keeps. */
export const MAX_TURN_POINTS = 24;
/** Zorvo's estimate: about four characters make a token. */
export const CHARS_PER_TOKEN = 4;

export type CategoryKey =
  | "systemPrompt"
  | "builtinTools"
  | "mcpTools"
  | "instructionFiles"
  | "memoryFiles"
  | "skills"
  | "startupContext"
  | "messages"
  | "freeSpace"
  | "autocompactBuffer";

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  systemPrompt: "System prompt",
  builtinTools: "Built-in tools",
  mcpTools: "MCP tools",
  instructionFiles: "Instruction files",
  memoryFiles: "Memory",
  skills: "Skills",
  startupContext: "Startup context",
  messages: "Messages",
  freeSpace: "Free",
  autocompactBuffer: "Autocompact buffer",
};

export interface ContextItem {
  name: string;
  tokens: number;
}

export interface ContextCategory {
  key: CategoryKey;
  tokens: number;
  items: ContextItem[];
  /** How many items the backend left out. */
  more: number;
}

/** What the agent itself says fills its window (Qwen Code only), as `acp_context_usage` returns it. */
export interface ContextBreakdown {
  modelName: string | null;
  windowSize: number;
  isEstimated: boolean;
  categories: ContextCategory[];
}

/** An instruction file's size, as `instruction_files` returns it. */
export interface InstructionFile {
  path: string;
  bytes: number;
}

/** One row of "What fills it". */
export interface FillRow {
  label: string;
  tokens: number;
  /** The rows that open under it (tools, files, skills). */
  items: ContextItem[];
  more: number;
  /** Zorvo's own count, shown with "~". */
  isEstimate: boolean;
}

const KEYS = new Set<string>(Object.keys(CATEGORY_LABELS));

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function toItem(raw: unknown): ContextItem | null {
  if (!isObject(raw) || typeof raw.name !== "string" || !isCount(raw.tokens)) return null;
  return { name: raw.name, tokens: raw.tokens };
}

function toCategory(raw: unknown): ContextCategory | null {
  if (!isObject(raw) || typeof raw.key !== "string" || !KEYS.has(raw.key) || !isCount(raw.tokens)) return null;
  if (!Array.isArray(raw.items) || !isCount(raw.more)) return null;
  const items = raw.items.map(toItem);
  if (items.some((item) => item === null)) return null;
  return { key: raw.key as CategoryKey, tokens: raw.tokens, items: items as ContextItem[], more: raw.more };
}

/** Reads `acp_context_usage`'s answer; null for anything of another shape. */
export function parseBreakdown(raw: unknown): ContextBreakdown | null {
  if (!isObject(raw) || !isCount(raw.windowSize) || typeof raw.isEstimated !== "boolean" || !Array.isArray(raw.categories)) return null;
  const categories = raw.categories.map(toCategory);
  if (categories.some((category) => category === null)) return null;
  const modelName = typeof raw.modelName === "string" ? raw.modelName : null;
  return { modelName, windowSize: raw.windowSize, isEstimated: raw.isEstimated, categories: categories as ContextCategory[] };
}

/** Reads `instruction_files`'s answer, dropping anything of another shape. */
export function parseInstructionFiles(raw: unknown): InstructionFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is InstructionFile => isObject(f) && typeof f.path === "string" && isCount(f.bytes));
}

export interface ContextTotals {
  used: number;
  /** 0 when the agent does not say how big its window is. */
  size: number;
  /** Null without a size. */
  percent: number | null;
  left: number | null;
  isNearlyFull: boolean;
}

export function contextTotals({ used, size }: ContextUsage): ContextTotals {
  if (size <= 0) return { used, size: 0, percent: null, left: null, isNearlyFull: false };
  const percent = Math.min(100, (used / size) * 100);
  return { used, size, percent, left: Math.max(0, size - used), isNearlyFull: percent >= NEARLY_FULL_AT };
}

/** The bar's three parts, in tokens: what is used, what is free, and the buffer the agent keeps back. */
export function barParts(totals: ContextTotals, buffer: number): { used: number; free: number; buffer: number } | null {
  if (totals.size <= 0) return null;
  const used = Math.min(totals.used, totals.size);
  const kept = Math.min(buffer, totals.size - used);
  return { used, free: totals.size - used - kept, buffer: kept };
}

/** The buffer the agent keeps back before it compacts on its own, when it reports one. */
export function bufferOf(breakdown: ContextBreakdown | null): number {
  return breakdown?.categories.find((c) => c.key === "autocompactBuffer")?.tokens ?? 0;
}

/** What fills the window as the agent reports it: every category but free space and the buffer, the empty ones left out. */
export function agentFills(breakdown: ContextBreakdown): FillRow[] {
  return breakdown.categories
    .filter((c) => c.key !== "freeSpace" && c.key !== "autocompactBuffer" && (c.tokens > 0 || c.key === "messages"))
    .map((c) => ({ label: CATEGORY_LABELS[c.key], tokens: c.tokens, items: c.items, more: c.more, isEstimate: false }));
}

const tokensOfChars = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

/** The characters of the chat as the agent was sent and wrote it: messages, reasoning, and the tools' text. */
export function transcriptChars(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length + (message.thinking?.length ?? 0);
    for (const tool of message.tools ?? []) {
      chars += tool.command?.length ?? 0;
      for (const detail of tool.details ?? []) if (detail.kind === "text") chars += detail.text.length;
    }
  }
  return chars;
}

/**
 * Zorvo's count for an agent that reports only the total: the chat and the instruction files it can
 * measure, and the rest of `used` as one row for the system prompt, tools, skills and memory together.
 */
export function zorvoFills(used: number, messageChars: number, files: readonly InstructionFile[]): FillRow[] {
  const messages = tokensOfChars(messageChars);
  const items = files.map((file) => ({ name: file.path, tokens: tokensOfChars(file.bytes) }));
  const instructions = items.reduce((sum, item) => sum + item.tokens, 0);
  const rows: FillRow[] = [{ label: CATEGORY_LABELS.messages, tokens: messages, items: [], more: 0, isEstimate: true }];
  if (instructions > 0) rows.push({ label: CATEGORY_LABELS.instructionFiles, tokens: instructions, items, more: 0, isEstimate: true });
  rows.push({ label: "Everything else", tokens: Math.max(0, used - messages - instructions), items: [], more: 0, isEstimate: true });
  return rows;
}

/** The agent's command that compacts its context, `compact` before `compress`; null when it has neither. */
export function compactCommandOf(commands: readonly SlashCommand[]): string | null {
  const names = new Set(commands.map((c) => c.name.replace(/^\//, "")));
  if (names.has("compact")) return "compact";
  if (names.has("compress")) return "compress";
  return null;
}

/** The turn-end history with one more point, keeping the last `MAX_TURN_POINTS`. */
export function withTurnPoint(points: readonly number[] | undefined, used: number): number[] {
  return [...(points ?? []), used].slice(-MAX_TURN_POINTS);
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "577k", "1M", "48.1k". */
export const compactTokens = (n: number): string => COMPACT.format(n).toLowerCase().replace(/m$/, "M");

/** "57.7%", "91%". */
export const percentText = (p: number): string => `${Math.round(p * 10) / 10}%`;

/** A share of the window, with no decimals under one percent ("0.4%", "0%"). */
export function shareOf(tokens: number, size: number): string | null {
  if (size <= 0) return null;
  return percentText((tokens / size) * 100);
}

/** An amount in its currency, e.g. "$0.42"; an unknown currency code is written out. */
export function moneyText({ amount, currency }: NonNullable<ContextUsage["cost"]>): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
