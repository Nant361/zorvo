import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBackgroundProcesses } from './useBackgroundProcesses';
import { backgroundTasksOf, type BackgroundTask } from '../lib/background-tasks';
import type { TaskTab } from './useTaskTabs';
import type { ChatMessage, Session } from '../types';

export interface BackgroundTasksArgs {
  sessions: readonly Session[];
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  isBusy: (sessionId: string) => boolean;
  busySince: (sessionId: string) => number | undefined;
  needsApproval: (sessionId: string) => boolean;
  onOpenSession: (sessionId: string) => void;
  /** Shows a subagent's or a shell command's task beside its chat, once its session is selected. */
  onOpenTask?: (sessionId: string, tab: TaskTab) => void;
  /**
   * Stops an agent's turn through the app's interrupt path, which also answers
   * pending permission requests and handles a starting or rewinding agent.
   */
  stopAgent: (sessionId: string) => void | Promise<void>;
  onError: (message: string) => void;
}

/** The task tab a row opens: a subagent's by its tool call, a shell command's by its row; a working session has none. */
export function taskTabOf(task: BackgroundTask): TaskTab | undefined {
  if (task.kind === 'shell') return { kind: 'shell', taskId: task.id };
  const prefix = `tool:${task.sessionId}:`;
  if (task.kind !== 'subagent' || !task.id.startsWith(prefix)) return undefined;
  return { kind: 'subagent', toolId: task.id.slice(prefix.length) };
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

/** What is running in the background, for the TopBar menu, with Open and Stop. */
export interface BackgroundTasks {
  tasks: BackgroundTask[];
  isMenuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  open: (task: BackgroundTask) => void;
  /** True when the backend call succeeded; false after reporting the failure through `onError`. */
  stop: (task: BackgroundTask) => Promise<boolean>;
}

export function useBackgroundTasks(args: BackgroundTasksArgs): BackgroundTasks {
  const { sessions, transcripts, isBusy, busySince, needsApproval, onOpenSession, onOpenTask, stopAgent, onError } = args;
  const [isMenuOpen, setMenuOpen] = useState(false);
  const hasLiveSessions = sessions.some((s) => s.status === 'running');
  const { processes, readAt, reload } = useBackgroundProcesses(hasLiveSessions, isMenuOpen, onError);

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

  const open = useCallback(
    (task: BackgroundTask) => {
      onOpenSession(task.sessionId);
      const tab = taskTabOf(task);
      if (tab) onOpenTask?.(task.sessionId, tab);
    },
    [onOpenSession, onOpenTask],
  );

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

  return { tasks, isMenuOpen, setMenuOpen, open, stop };
}
