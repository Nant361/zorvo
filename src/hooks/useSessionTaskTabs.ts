import { useCallback } from 'react';
import { findShellTask, type BackgroundTask } from '../lib/background-tasks';
import { findTaskTool } from '../lib/task-view';
import type { ChatMessage } from '../types';
import { useTaskTabs, type TaskTab, type TaskTabs } from './useTaskTabs';

/**
 * The task tabs of the session on screen, each kept only while its task exists: a subagent while
 * its tool call is in the transcript, a shell command while it is listed as running.
 */
export function useSessionTaskTabs(args: {
  sessionId: string | null;
  transcripts: Readonly<Record<string, readonly ChatMessage[]>>;
  tasks: readonly BackgroundTask[];
}): TaskTabs {
  const { sessionId, transcripts, tasks } = args;
  const exists = useCallback(
    (tab: TaskTab) => {
      if (sessionId === null) return false;
      return tab.kind === 'subagent'
        ? findTaskTool(transcripts[sessionId] ?? [], tab.toolId) !== undefined
        : findShellTask(tasks, tab.taskId, transcripts)?.sessionId === sessionId;
    },
    [sessionId, transcripts, tasks],
  );
  return useTaskTabs({ sessionId, exists });
}
