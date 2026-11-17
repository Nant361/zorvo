import { runningTurnReplyIndexes } from './acp-events';
import type { ChatMessage, Session, ToolExecution } from '../types';

/** What a background row stands for. */
export type BackgroundTaskKind = 'agent' | 'shell' | 'subagent';

/** A shell process an agent started, as the backend reports it. */
export interface BackgroundProcess {
  pid: number;
  sessionId: string;
  command: string;
  elapsedSecs: number;
  ports: number[];
}

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  name: string;
  detail?: string;
  status: 'Working' | 'Needs approval' | 'Running';
  startedAt: number;
  sessionId: string;
  /** The OS process a shell task can be stopped through. */
  pid?: number;
}

export interface BackgroundTasksInput {
  sessions: readonly Session[];
  isBusy: (sessionId: string) => boolean;
  busySince: (sessionId: string) => number | undefined;
  needsApproval: (sessionId: string) => boolean;
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  processes: readonly BackgroundProcess[];
  /** When `processes` was read; process start times are anchored to it. */
  processesReadAt: number;
}

/** Tool names an agent uses for a subagent run: Claude's Task/Agent, Qwen's agent. */
const SUBAGENT_TOOLS = new Set(['task', 'agent']);

/**
 * Whether a running tool is a subagent. Kind alone cannot say: Claude and Codex
 * report plain reasoning as `think` too, so the adapter's own tool name decides,
 * with a title that names the subagent as the fallback for older adapters.
 */
function isSubagent(tool: ToolExecution): boolean {
  const provider = tool.providerToolName?.toLowerCase();
  if (provider && SUBAGENT_TOOLS.has(provider)) return true;
  return /^(task|agent|subagent)\b/i.test(tool.name);
}

function toolKind(tool: ToolExecution): 'shell' | 'subagent' | undefined {
  if (isSubagent(tool)) return 'subagent';
  return tool.kind === 'execute' ? 'shell' : undefined;
}

/**
 * The running tool calls in each session's running turn. Every reply of the turn counts: an
 * answered permission request closes its reply, and a subagent it holds keeps working there. A
 * finished turn keeps a running tool in the transcript (`closeTurn` leaves it alone), so older
 * turns are not scanned. A command that outlives its turn shows through its process instead.
 */
export function runningToolTasks(
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>,
  sessions: readonly Session[],
): BackgroundTask[] {
  return sessions.flatMap((session) => {
    const messages = transcripts[session.id] ?? [];
    return runningTurnReplyIndexes(messages).reverse().flatMap((index) => toolTasksOf(session, messages[index]));
  });
}

function toolTasksOf(session: Session, message: ChatMessage): BackgroundTask[] {
  return (message.tools ?? []).flatMap((tool): BackgroundTask[] => {
    const kind = toolKind(tool);
    if (tool.status !== 'running' || !kind) return [];
    return [
      {
        id: `tool:${session.id}:${tool.id}`,
        kind,
        name: tool.name,
        detail: session.name,
        status: 'Running',
        startedAt: tool.startedAt ?? message.timestamp,
        sessionId: session.id,
      },
    ];
  });
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A tool's title and a process's command describe the same work when one contains the other. */
function namesSameWork(tool: BackgroundTask, process: BackgroundTask): boolean {
  const title = normalized(tool.name);
  const command = normalized(process.name);
  return title.includes(command) || command.includes(title);
}

/**
 * Drops the shell tool row for each process already listed, preferring the
 * process: it carries the ports and can be stopped. A process matches by
 * command first; a process with no command match claims a tool only when
 * exactly one unclaimed tool of its session started before it, so a second
 * running command is never hidden behind the first one. Subagent rows stand on
 * their own and are never claimed by a process.
 */
function dedupeToolTasks(
  tools: readonly BackgroundTask[],
  processes: readonly BackgroundTask[],
): BackgroundTask[] {
  const shells = tools.filter((tool) => tool.kind === 'shell');
  const newestFirst = [...shells].sort((a, b) => b.startedAt - a.startedAt);
  const claimed = new Set<string>();

  const unmatched: BackgroundTask[] = [];
  for (const process of processes) {
    const match = newestFirst.find(
      (tool) => !claimed.has(tool.id) && tool.sessionId === process.sessionId && namesSameWork(tool, process),
    );
    if (match) claimed.add(match.id);
    else unmatched.push(process);
  }

  for (const process of unmatched) {
    const candidates = shells.filter(
      (tool) => !claimed.has(tool.id) && tool.sessionId === process.sessionId && process.startedAt >= tool.startedAt,
    );
    if (candidates.length === 1) claimed.add(candidates[0].id);
  }

  return tools.filter((tool) => tool.kind !== 'shell' || !claimed.has(tool.id));
}

/** Everything running in the background, oldest first. */
export function backgroundTasksOf(input: BackgroundTasksInput): BackgroundTask[] {
  const { sessions, isBusy, busySince, needsApproval, transcripts, processes, processesReadAt } = input;
  const names = new Map(sessions.map((s) => [s.id, s.name]));

  const sessionTasks = sessions
    .filter((session) => isBusy(session.id))
    .map(
      (session): BackgroundTask => ({
        id: `agent:${session.id}`,
        kind: 'agent',
        name: session.name,
        status: needsApproval(session.id) ? 'Needs approval' : 'Working',
        startedAt: busySince(session.id) ?? session.createdAt,
        sessionId: session.id,
      }),
    );

  const processTasks = processes.map((process): BackgroundTask => {
    const sessionName = names.get(process.sessionId);
    const ports = process.ports.map((port) => `localhost:${port}`);
    const detail = [sessionName, ...ports].filter((part): part is string => Boolean(part)).join(' · ');
    return {
      id: `process:${process.pid}`,
      kind: 'shell',
      name: process.command,
      ...(detail ? { detail } : {}),
      status: 'Running',
      startedAt: processesReadAt - process.elapsedSecs * 1000,
      sessionId: process.sessionId,
      pid: process.pid,
    };
  });

  const toolTasks = dedupeToolTasks(runningToolTasks(transcripts, sessions), processTasks);

  return [...sessionTasks, ...processTasks, ...toolTasks].sort((a, b) => a.startedAt - b.startedAt);
}

const TOOL_TASK_PREFIX = 'tool:';

/** The tool call a tool row stands for, from its id (`tool:<session>:<tool>`). */
function toolIdOf(task: BackgroundTask): string | undefined {
  const prefix = `${TOOL_TASK_PREFIX}${task.sessionId}:`;
  return task.id.startsWith(prefix) ? task.id.slice(prefix.length) : undefined;
}

/**
 * The tool call a shell task's output comes from: a tool row's own, or for a process the newest
 * command of its session that names the same work. A process nothing matches has none.
 */
export function shellToolFor(task: BackgroundTask, messages: readonly ChatMessage[]): ToolExecution | undefined {
  const tools = messages.flatMap((message) => message.tools ?? []);
  const ownId = toolIdOf(task);
  if (ownId !== undefined) return tools.find((tool) => tool.id === ownId);
  const command = normalized(task.name);
  // An empty command is contained in every title, so it names no work.
  if (command === '') return undefined;
  return [...tools].reverse().find((tool) => {
    if (tool.kind !== 'execute') return false;
    const title = normalized(tool.command ?? tool.name);
    return title !== '' && (title.includes(command) || command.includes(title));
  });
}

/**
 * The shell task a tab was opened for. A command first shows as its running tool call and then as
 * its process, under another id, so a tab opened on the tool row follows it to the process.
 */
export function findShellTask(
  tasks: readonly BackgroundTask[],
  taskId: string,
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>,
): BackgroundTask | undefined {
  const shells = tasks.filter((task) => task.kind === 'shell');
  const exact = shells.find((task) => task.id === taskId);
  if (exact || !taskId.startsWith(TOOL_TASK_PREFIX)) return exact;
  return shells.find((task) => {
    const tool = task.pid === undefined ? undefined : shellToolFor(task, transcripts[task.sessionId] ?? []);
    return tool !== undefined && `${TOOL_TASK_PREFIX}${task.sessionId}:${tool.id}` === taskId;
  });
}

const PORT_PART = /^localhost:\d+$/;

/** The `localhost:PORT` parts of a shell task's detail, which `backgroundTasksOf` writes. */
export function portsOf(task: BackgroundTask): string[] {
  return (task.detail ?? '').split(' · ').filter((part) => PORT_PART.test(part));
}

/** "45s", "2m 13s" or "1h 04m". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
