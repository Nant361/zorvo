import type { ChatMessage } from '../types';

/** A file the agent made in this session, as its own report says. */
export interface CreatedFile {
  /** Absolute when the session's folder was given, else as the agent named it. */
  path: string;
  /** When the tool that made it started; null for a session's history replayed on import, whose times are not known. */
  at: number | null;
}

/**
 * The files the agent created: a tool whose diff marks a new file and that reached `completed`, since an
 * agent can send a diff before a permission is refused. One row per path, the newest first, rows whose time
 * is not known (an imported session's history) last. A subagent's tool counts too: it stays in the reply's `tools`.
 */
export function createdFilesOf(messages: readonly ChatMessage[], cwd?: string): CreatedFile[] {
  // Messages come oldest first, so the last report of a path is its newest, timed or not.
  const latest = new Map<string, number | null>();
  for (const message of messages) {
    for (const file of createdIn(message)) {
      // One file named relative by one tool and absolute by another is still one row.
      latest.set(cwd ? absoluteIn(file.path, cwd) : file.path, file.at);
    }
  }
  const order = (at: number | null) => at ?? Number.NEGATIVE_INFINITY;
  return [...latest].map(([path, at]) => ({ path, at })).sort((a, b) => order(b.at) - order(a.at));
}

/** An agent's relative path as an absolute one under `cwd`; an absolute path as it is. */
function absoluteIn(path: string, cwd: string): string {
  if (path.startsWith('/')) return path;
  return `${cwd.replace(/\/+$/, '')}/${path.replace(/^(\.\/)+/, '')}`;
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
      // A diff too large to keep is summarised as `changed`, which still says whether it made the file.
      const isCreated = (detail.kind === 'diff' || detail.kind === 'changed') && detail.isNewFile === true;
      if (isCreated && detail.path !== '') {
        files.push({ path: detail.path, at: message.hasKnownTime === false ? null : (tool.startedAt ?? message.timestamp) });
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
