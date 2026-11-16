import { isSubagent } from './background-tasks';
import type { ChatMessage, ChatMessagePart, ToolExecution } from '../types';

/**
 * What a subagent's tool call shows as a task: the row in the chat and the tab beside it. All of
 * it is read from the transcript, so a rewind removes a task with its message.
 */

export type TaskStatus = 'Working' | 'Needs you' | 'Done' | 'Failed' | 'Did not finish';

export interface SubagentTask {
  toolId: string;
  title: string;
  agentType?: string;
  /** The tool calls the subagent made. */
  stepCount: number;
  status: TaskStatus;
  startedAt?: number;
  /** False when the agent does not mark its subagent's updates: there is nothing to open. */
  hasSteps: boolean;
  /** The subagent's last text, which is what it handed back. */
  lastText?: string;
}

/** The tools a reply lists itself: a subagent's own tools show under their parent. */
export function shownTools(tools: readonly ToolExecution[]): ToolExecution[] {
  return tools.filter((tool) => tool.parentId === undefined);
}

/** Whether a tool call is a subagent: it has steps, or its agent names it as one. */
export function isTaskTool(tool: ToolExecution): boolean {
  return tool.steps !== undefined || isSubagent(tool);
}

function childrenOf(tool: ToolExecution, message: ChatMessage): ToolExecution[] {
  return (message.tools ?? []).filter((candidate) => candidate.parentId === tool.id);
}

/** Whether the reply's open permission request is for one of this subagent's tool calls. */
function isWaitingOnUser(tool: ToolExecution, message: ChatMessage): boolean {
  const card = message.actionCard;
  if (card?.status !== 'pending' || card.toolCallId === undefined) return false;
  return childrenOf(tool, message).some((child) => child.id === card.toolCallId);
}

function statusOf(tool: ToolExecution, message: ChatMessage, isTurnOver: boolean): TaskStatus {
  if (tool.status === 'failed') return 'Failed';
  if (tool.status === 'completed') return 'Done';
  if (isTurnOver) return 'Did not finish';
  return isWaitingOnUser(tool, message) ? 'Needs you' : 'Working';
}

export function subagentTaskOf(tool: ToolExecution, message: ChatMessage, on: { isTurnOver: boolean }): SubagentTask {
  const texts = (tool.steps ?? []).flatMap((step) => (step.kind === 'text' ? [step.text] : []));
  const lastText = texts[texts.length - 1];
  return {
    toolId: tool.id,
    title: tool.name,
    ...(tool.agentType ? { agentType: tool.agentType } : {}),
    stepCount: childrenOf(tool, message).length,
    status: statusOf(tool, message, on.isTurnOver),
    ...(tool.startedAt === undefined ? {} : { startedAt: tool.startedAt }),
    hasSteps: tool.steps !== undefined,
    ...(lastText ? { lastText } : {}),
  };
}

/** A subagent's steps and the tools they name, in the order the steps name them. */
export function stepsOf(tool: ToolExecution, message: ChatMessage): { parts: ChatMessagePart[]; tools: ToolExecution[] } {
  const parts = tool.steps ?? [];
  const byId = new Map(childrenOf(tool, message).map((child) => [child.id, child]));
  const ids = parts.flatMap((part) => (part.kind === 'tools' ? part.toolIds : []));
  return { parts, tools: ids.flatMap((id) => byId.get(id) ?? []) };
}

/** The row's second line: the subagent's type and how much it did, or why there is nothing to open. */
export function secondLine(task: SubagentTask, agentName: string): string {
  if (!task.hasSteps) return `${agentName} doesn't report this subagent's steps`;
  const steps = task.stepCount === 1 ? '1 step' : `${task.stepCount} steps`;
  return task.agentType ? `${task.agentType} · ${steps}` : steps;
}

/** The subagent tool call a task tab is for, with the reply that holds it; undefined once a rewind removed it. */
export function findTaskTool(
  messages: readonly ChatMessage[],
  toolId: string,
): { tool: ToolExecution; message: ChatMessage } | undefined {
  for (const message of messages) {
    const tool = message.tools?.find((candidate) => candidate.id === toolId);
    if (tool) return tool.steps === undefined ? undefined : { tool, message };
  }
  return undefined;
}
