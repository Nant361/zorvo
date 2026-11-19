import { folderNameOf, isCommandOnly, titleFromPrompt, titleSourceFor, workspacePathOf } from './session-helpers';
import { fileNameOf } from './attachments';
import type { ListedSession } from './session-list';
import type { FirstMessage } from '../hooks/session-engine/useAcpEngine';
import { hasPendingElicitation } from './acp-elicitation';
import { isAwaitingPermission } from './acp-events';
import { createId } from './ids';
import type { AcpChoices } from './acp-draft';
import {
  TRANSPORT_ACP,
  type AgentProfile,
  type ChatMessage,
  type DelegationLink,
  type OpenedByLink,
  type Session,
  type SessionWorktree,
} from '../types';

/** Who works where, for a title when the message says nothing a title could use. */
export interface TitlePlace {
  agentName: string;
  folderName: string;
}

/**
 * A session title from a message, or from its first file when it has no text. A message that is only a
 * slash command (`/init`) gives "{Agent} in {folder}", until the agent sends a title of its own.
 */
export function titleFor({ text, attachments }: FirstMessage, place?: TitlePlace): string {
  if (place && isCommandOnly(text)) return `${place.agentName} in ${place.folderName}`;
  return titleFromPrompt(text || fileNameOf(attachments?.[0] ?? ''));
}

/** The agent and folder a session's title names when its first message is only a command. */
export function titlePlaceOf(session: Session, agents: readonly AgentProfile[]): TitlePlace | undefined {
  const agentName = agents.find((agent) => agent.id === session.profileId)?.name;
  return agentName ? { agentName, folderName: folderNameOf(workspacePathOf(session)) } : undefined;
}

/** A session's name from its first message, with the whole line it was cut from when it was cut. */
export function namingFor(first: FirstMessage, place?: TitlePlace): Pick<Session, 'name' | 'titleSource'> {
  const name = titleFor(first, place);
  const titleSource = titleSourceFor(first.text, name);
  return titleSource ? { name, titleSource } : { name };
}

/** What a new session is recorded and started with. */
export interface SessionSpec {
  id?: string;
  agent: AgentProfile;
  cwd: string;
  name: string;
  /** The whole line `name` was cut from, for its hover. */
  titleSource?: string;
  forkedFrom?: string;
  initialMessages?: ChatMessage[];
  worktree?: SessionWorktree | null;
  /** The agent's own session to reopen, for a session started outside Zorvo. */
  acpSessionId?: string;
  /** The compare run this session belongs to. */
  compareRunId?: string | null;
  /** The session this one was delegated from, when another agent started it. */
  delegatedFrom?: DelegationLink;
  /** The session whose agent opened this one through Zorvo's tools. */
  openedBy?: OpenedByLink;
  /** When the session was made; a run gives its sessions successive times, so they keep the order of its agents. */
  createdAt?: number;
  /** A Zorvo Private session, its model, whose key it spends, and its credit cap. */
  privateMode?: { modelId: string; ownKey?: boolean; sessionCap?: number };
}

/** How a session is started beyond its spec. */
export interface StartSessionOptions {
  /** What the session starts with, for a caller whose agent is not the draft's. */
  choices?: AcpChoices;
  /** Whether the session opens in the window; true when absent. */
  focus?: boolean;
}

/** The record of a session about to start: running, with the spec's agent and folder. */
export function newSessionRecord(spec: SessionSpec, createdAt: number = spec.createdAt ?? Date.now()): Session {
  const { id, agent, cwd, name, titleSource, forkedFrom, worktree, acpSessionId, compareRunId, privateMode, delegatedFrom, openedBy } = spec;
  return {
    id: id ?? createId('s'),
    name,
    profileId: agent.id,
    cwd,
    status: 'running',
    createdAt,
    forkedFrom: forkedFrom ?? null,
    transport: TRANSPORT_ACP,
    worktree: worktree ?? null,
    acpSessionId: acpSessionId ?? null,
    ...(titleSource !== undefined ? { titleSource } : {}),
    ...(compareRunId !== undefined ? { compareRunId } : {}),
    ...(privateMode
      ? {
          privateMode: {
            modelId: privateMode.modelId,
            ...(privateMode.ownKey ? { ownKey: true } : {}),
            ...(privateMode.sessionCap !== undefined ? { sessionCap: privateMode.sessionCap } : {}),
          },
        }
      : {}),
    ...(delegatedFrom !== undefined ? { delegatedFrom } : {}),
    ...(openedBy !== undefined ? { openedBy } : {}),
  };
}

/**
 * The record spec for a session the agent listed: its own title, or one made
 * from the agent and the day it was last used, so no row is ever blank.
 */
export function importedSessionSpec(
  listed: ListedSession,
  agent: AgentProfile,
  cwd: string,
  now: number = Date.now(),
): SessionSpec {
  // The first line that has text: a markdown title can run over several lines,
  // and a name is always one line.
  const firstLine = (listed.title ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  const parsed = new Date(listed.updatedAt ?? now);
  // Rust accepts a leap second (`:60`), which Date reads as invalid: date it by the import time instead.
  const updatedAt = Number.isNaN(parsed.getTime()) ? new Date(now) : parsed;
  const date = updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const name = firstLine ? titleFromPrompt(firstLine) : `${agent.name} session, ${date}`;
  const titleSource = firstLine ? titleSourceFor(firstLine, name) : undefined;
  return {
    agent,
    cwd,
    name,
    ...(titleSource ? { titleSource } : {}),
    acpSessionId: listed.acpSessionId,
  };
}

/**
 * Whether a session's agent waits for the user's answer: it stays busy while
 * it asks for permission, and an elicitation waits even between turns.
 * `isBusy` is asked only for a running session.
 */
export function isWaitingForAnswer(
  session: Session | undefined,
  messages: readonly ChatMessage[],
  isBusy: () => boolean,
): boolean {
  if (session?.status !== 'running') return false;
  return hasPendingElicitation(messages) || (isBusy() && isAwaitingPermission(messages));
}
