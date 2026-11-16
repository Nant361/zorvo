import { useEffect, useRef } from 'react';
import type { AgentProfile } from '../types';
import { autoInstallTargets } from '../lib/agent-catalog';
import { installEntryOf, startInstall, subscribeToInstalls } from '../lib/agent-installs';
import { useLatest } from './useLatest';

interface AutoInstallOptions {
  agentsInUse: readonly AgentProfile[];
  /** True once the saved state and the agent profiles are loaded and the welcome screen is done. */
  isReady: boolean;
}

/**
 * Installs the agents in use whose npm package Zorvo has not installed yet (see
 * `autoInstallTargets`): one at a time, through the Install button's own path, so the rows
 * show the same progress and Cancel. Each agent is tried once per run of the app: an install
 * that fails or is cancelled is not tried again until Zorvo is opened again, and its row
 * offers Install.
 *
 * The agents are read again every time one is picked, never kept in a list: startup puts an
 * agent found on this Mac in use a render after the profiles load, and the user may take one
 * out of use while another installs.
 */
export function useAutoInstall({ agentsInUse, isReady }: AutoInstallOptions): void {
  const agentsRef = useLatest(agentsInUse);
  /** Every agent this run has picked, whether it was started or left to the user's own install. */
  const attemptedRef = useRef<Set<string>>(new Set());
  const currentRef = useRef<string | null>(null);
  const advanceRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!isReady) return;
    const attempted = attemptedRef.current;

    const advance = () => {
      const current = currentRef.current;
      if (current !== null && installEntryOf(current).status === 'installing') return;
      currentRef.current = null;
      for (const id of autoInstallTargets(agentsRef.current)) {
        if (attempted.has(id)) continue;
        attempted.add(id);
        // An agent the user is installing right now is theirs: leave it.
        if (installEntryOf(id).status === 'installing') continue;
        currentRef.current = id;
        startInstall(id);
        return;
      }
    };

    advanceRef.current = advance;
    const unsubscribe = subscribeToInstalls(advance);
    advance();
    return () => {
      unsubscribe();
      advanceRef.current = () => {};
    };
  }, [isReady, agentsRef]);

  // An agent that came into use since the last pick gets its turn. The ids as one string:
  // `agentsInUse` is a new list on every render of `App`, and this must run only when the
  // agents to install change.
  const targetIds = autoInstallTargets(agentsInUse).join('\n');
  useEffect(() => {
    advanceRef.current();
  }, [targetIds]);
}
