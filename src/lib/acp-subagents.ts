import type { ChatMessage, ChatMessagePart, ToolExecution } from '../types';

/**
 * Files what a subagent does under the tool call that started it.
 *
 * Claude Code and Qwen Code mark every update of a subagent with its parent's tool call id. Without
 * this, a subagent's tool calls, text and reasoning are folded into the reply as the agent's own.
 * Everything here comes from the agent process: a parent id that names no tool of the reply files
 * nothing, and the caller folds the update the usual way.
 */

/** A subagent's text is kept in memory and in the saved transcript, so it is bounded. */
export const MAX_SUBAGENT_TEXT = 20_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The tool call an update's subagent was started by: Claude Code nests it, Qwen Code sends it at the top. */
export function parentToolIdOf(meta: unknown): string | undefined {
  if (!isObject(meta)) return undefined;
  const claude = isObject(meta.claudeCode) ? nonEmpty(meta.claudeCode.parentToolUseId) : undefined;
  return claude ?? nonEmpty(meta.parentToolCallId);
}

/** The subagent's type as the agent names it; only Qwen Code reports one. */
export function agentTypeOf(meta: unknown): string | undefined {
  return isObject(meta) ? nonEmpty(meta.subagentType) : undefined;
}

/** The reply with `change` applied to its tool `parentId`, or undefined when it has no such tool. */
function withParent(
  reply: ChatMessage,
  parentId: string,
  change: (parent: ToolExecution) => ToolExecution,
  added: readonly ToolExecution[] = [],
): ChatMessage | undefined {
  const tools = reply.tools ?? [];
  if (!tools.some((tool) => tool.id === parentId)) return undefined;
  return { ...reply, tools: [...tools.map((tool) => (tool.id === parentId ? change(tool) : tool)), ...added] };
}

function withStepTool(steps: readonly ChatMessagePart[], toolId: string): ChatMessagePart[] {
  const last = steps[steps.length - 1];
  return last?.kind === 'tools'
    ? [...steps.slice(0, -1), { kind: 'tools', toolIds: [...last.toolIds, toolId] }]
    : [...steps, { kind: 'tools', toolIds: [toolId] }];
}

function withStepText(steps: readonly ChatMessagePart[], chunk: string): ChatMessagePart[] {
  const last = steps[steps.length - 1];
  return last?.kind === 'text'
    ? [...steps.slice(0, -1), { kind: 'text', text: last.text + chunk }]
    : [...steps, { kind: 'text', text: chunk }];
}

function textLength(steps: readonly ChatMessagePart[]): number {
  return steps.reduce((sum, step) => (step.kind === 'text' ? sum + step.text.length : sum), 0);
}

/** Adds a subagent's tool call to the reply's tools and to its parent's steps, not to the reply's parts. */
export function withChildTool(
  reply: ChatMessage,
  parentId: string,
  tool: ToolExecution,
  agentType?: string,
): ChatMessage | undefined {
  // A tool cannot be its own subagent, whatever the agent sends.
  if (tool.id === parentId) return undefined;
  return withParent(
    reply,
    parentId,
    (parent) => ({
      ...parent,
      steps: withStepTool(parent.steps ?? [], tool.id),
      ...(agentType && !parent.agentType ? { agentType } : {}),
    }),
    [{ ...tool, parentId }],
  );
}

/** Appends a subagent's text to its parent's steps; text past the cap is left out and marked. */
export function withChildText(reply: ChatMessage, parentId: string, chunk: string): ChatMessage | undefined {
  return withParent(reply, parentId, (parent) => {
    const steps = parent.steps ?? [];
    const room = MAX_SUBAGENT_TEXT - textLength(steps);
    if (parent.isTextCut || room <= 0) return { ...parent, isTextCut: true };
    const kept = chunk.slice(0, room);
    return { ...parent, steps: withStepText(steps, kept), ...(kept.length < chunk.length ? { isTextCut: true } : {}) };
  });
}

/** Appends a subagent's reasoning to its parent, bounded like its text. */
export function withChildThought(reply: ChatMessage, parentId: string, chunk: string): ChatMessage | undefined {
  return withParent(reply, parentId, (parent) => ({
    ...parent,
    thinking: ((parent.thinking ?? '') + chunk).slice(0, MAX_SUBAGENT_TEXT),
  }));
}
