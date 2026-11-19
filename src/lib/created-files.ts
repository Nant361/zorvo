import type { ChatMessage } from '../types';

/** A file the agent made in this session, as its own report says. */
export interface CreatedFile {
  /** As the agent named it: absolute, or relative to the session's folder. */
  path: string;
  /** When the tool that made it started. */
  at: number;
}

/**
 * The files the agent created: a tool whose diff marks a new file and that reached `completed`, since an
 * agent can send a diff before a permission is refused. One row per path, the newest first. A subagent's
 * tool counts too: it stays in the reply's `tools`.
 */
export function createdFilesOf(messages: readonly ChatMessage[]): CreatedFile[] {
  const newest = new Map<string, number>();
  for (const message of messages) {
    for (const file of createdIn(message)) {
      if (file.at >= (newest.get(file.path) ?? Number.NEGATIVE_INFINITY)) newest.set(file.path, file.at);
    }
  }
  return [...newest].map(([path, at]) => ({ path, at })).sort((a, b) => b.at - a.at);
}

/** One message's created files, kept per message: a reply is a new object whenever it changes, so the rest are not walked again on each streamed frame. */
const perMessage = new WeakMap<ChatMessage, readonly CreatedFile[]>();

function createdIn(message: ChatMessage): readonly CreatedFile[] {
  const known = perMessage.get(message);
  if (known) return known;
  const files: CreatedFile[] = [];
  for (const tool of message.tools ?? []) {
    if (tool.status !== 'completed') continue;
    for (const detail of tool.details ?? []) {
      if (detail.kind === 'diff' && detail.isNewFile && detail.path !== '') {
        files.push({ path: detail.path, at: tool.startedAt ?? message.timestamp });
      }
    }
  }
  perMessage.set(message, files);
  return files;
}

/**
 * A created file's path inside `folder`, for the file viewer: an agent's relative path as it is, an
 * absolute one with the folder taken off. Null outside the folder or for a path that climbs out of it.
 */
export function pathInFolder(path: string, folder: string): string | null {
  if (!path.startsWith('/')) {
    const relative = path.replace(/^(\.\/)+/, '');
    return relative === '' || relative.split('/').includes('..') ? null : relative;
  }
  const base = folder.replace(/\/+$/, '');
  if (base === '' || !path.startsWith(`${base}/`)) return null;
  const relative = path.slice(base.length + 1);
  return relative.split('/').includes('..') ? null : relative;
}

/** A file's name, and the folder it sits in as the row's second line shows it ("src/lib"), or "" at the top. */
export function fileNameAndFolder(path: string, folder: string): { name: string; where: string } {
  const shown = pathInFolder(path, folder) ?? path;
  const cut = shown.lastIndexOf('/');
  return cut === -1 ? { name: shown, where: '' } : { name: shown.slice(cut + 1), where: shown.slice(0, cut) };
}
