import { useEffect } from 'react';
import { agentWorkOf, isSameAgentWork, mergedAgentWork } from '../lib/agent-work';
import type { ChatMessage, Session } from '../types';

/**
 * Records on each session the branches and pull requests its agent made, read from every loaded
 * transcript whenever it changes, so the sidebar can show them after a restart without loading
 * the transcript again. A session whose transcript was never loaded in this run keeps what it had.
 */
export function useAgentWork(
  sessions: readonly Session[],
  transcripts: Readonly<Record<string, readonly ChatMessage[] | undefined>>,
  patchSession: (sessionId: string, patch: Partial<Session>) => void,
): void {
  useEffect(() => {
    for (const session of sessions) {
      const messages = transcripts[session.id];
      if (!messages) continue;
      const next = mergedAgentWork(session.agentWork, agentWorkOf(messages));
      if (next && !isSameAgentWork(session.agentWork, next)) patchSession(session.id, { agentWork: next });
    }
  }, [sessions, transcripts, patchSession]);
}
