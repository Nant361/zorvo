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
 * Installs, once per run of the app, the agents in use whose npm package Zorvo has not
 * installed yet (see `autoInstallTargets`): one at a time, through the Install button's own
 * path, so the rows show the same progress and Cancel. An install that fails or is
 * cancelled is not tried again until Zorvo is opened again; its row offers Install.
 */
export function useAutoInstall({ agentsInUse, isReady }: AutoInstallOptions): void {
  const agentsRef = useLatest(agentsInUse);
  /** The agents still to install; null until the run has taken them. */
  const queueRef = useRef<string[] | null>(null);
  const currentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    queueRef.current ??= autoInstallTargets(agentsRef.current);
    const queue = queueRef.current;

    const advance = () => {
      const current = currentRef.current;
      if (current !== null && installEntryOf(current).status === 'installing') return;
      currentRef.current = null;
      let next = queue.shift();
      // An agent the user is installing right now is theirs: skip it.
      while (next !== undefined && installEntryOf(next).status === 'installing') next = queue.shift();
      if (next === undefined) return;
      currentRef.current = next;
      startInstall(next);
    };

    const unsubscribe = subscribeToInstalls(advance);
    advance();
    return unsubscribe;
  }, [isReady, agentsRef]);
}
