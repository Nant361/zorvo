import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBackgroundProcesses } from './useBackgroundProcesses';
import { backgroundTasksOf, type BackgroundTask } from '../lib/background-tasks';
import type { ChatMessage, Session } from '../types';

export interface BackgroundTasksArgs {
  sessions: readonly Session[];
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  isBusy: (sessionId: string) => boolean;
  busySince: (sessionId: string) => number | undefined;
  needsApproval: (sessionId: string) => boolean;
  /** The session on screen: while it has a shell command alive, its listening ports are read too. */
  portsFor?: string | null;
  /**
   * Stops an agent's turn through the app's interrupt path, which also answers
   * pending permission requests and handles a starting or rewinding agent.
   */
  stopAgent: (sessionId: string) => void | Promise<void>;
  onError: (message: string) => void;
}

function stopCall(task: BackgroundTask, stopAgent: BackgroundTasksArgs['stopAgent']): Promise<unknown> {
  switch (task.kind) {
    case 'agent':
      return Promise.resolve(stopAgent(task.sessionId));
    case 'shell':
      return task.pid === undefined ? Promise.resolve() : invoke('stop_background_process', { pid: task.pid });
    case 'subagent':
      return Promise.resolve();
  }
}

/** What is running in the background, for the overview card and the task tabs, with Stop. */
export interface BackgroundTasks {
  tasks: BackgroundTask[];
  /** True when the backend call succeeded; false after reporting the failure through `onError`. */
  stop: (task: BackgroundTask) => Promise<boolean>;
}

export function useBackgroundTasks(args: BackgroundTasksArgs): BackgroundTasks {
  const { sessions, transcripts, isBusy, busySince, needsApproval, portsFor, stopAgent, onError } = args;
  const [withPorts, setWithPorts] = useState(false);
  const hasLiveSessions = sessions.some((s) => s.status === 'running');
  const { processes, readAt, reload } = useBackgroundProcesses(hasLiveSessions, withPorts, onError);

  const tasks = useMemo(
    () =>
      backgroundTasksOf({
        sessions,
        transcripts,
        isBusy,
        busySince,
        needsApproval,
        processes,
        processesReadAt: readAt,
      }),
    [sessions, transcripts, isBusy, busySince, needsApproval, processes, readAt],
  );

  // The card and the task tab show a shell command's ports; finding them is slow, so only while one is on screen.
  const hasShellOnScreen = Boolean(portsFor) && tasks.some((task) => task.kind === 'shell' && task.sessionId === portsFor);
  if (hasShellOnScreen !== withPorts) setWithPorts(hasShellOnScreen);

  const stop = useCallback(
    async (task: BackgroundTask): Promise<boolean> => {
      let isStopped = true;
      try {
        await stopCall(task, stopAgent);
      } catch (error) {
        isStopped = false;
        onError(`Could not stop ${task.name}: ${String(error)}`);
      }
      reload();
      return isStopped;
    },
    [onError, reload, stopAgent],
  );

  return { tasks, stop };
}
