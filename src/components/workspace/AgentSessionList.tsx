import { Button } from '../ui/Button';
import { formatRelativeTime } from '../../lib/relative-time';
import type { SessionListState } from '../../hooks/useAgentSessionList';
import type { ListedSession } from '../../lib/session-list';

export interface AgentSessionListProps {
  /** The agent the draft would start, named in every line. */
  agentName: string;
  state: SessionListState;
  /** Why the last import failed; kept apart from the list's own state. */
  importError: string | null;
  onLoad: () => void;
  onImport: (listed: ListedSession) => void;
}

/** A session's `updatedAt` as how long ago it was; nothing when it has no readable date. */
function relativeTime(updatedAt: string | undefined): string | null {
  if (!updatedAt) return null;
  const time = Date.parse(updatedAt);
  return Number.isNaN(time) ? null : formatRelativeTime(time);
}

/**
 * One of the agent's sessions, as the canvas draws it (`CalmHome`): a plain 36px row with its title and time, a
 * hairline under it and no box on hover, only brighter text. The row is the one button; the heading says it continues.
 */
function SessionRow({ listed, onImport }: { listed: ListedSession; onImport: (listed: ListedSession) => void }) {
  const time = relativeTime(listed.updatedAt);
  const title = listed.title ?? 'Untitled session';
  return (
    <button
      type="button"
      onClick={() => onImport(listed)}
      className="group focus-ring flex h-9 w-full items-center gap-3 rounded-sm px-1 text-left text-ui text-fg-secondary transition-colors hover:text-fg"
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {time && <span className="shrink-0 text-caption text-fg-muted">{time}</span>}
    </button>
  );
}

/**
 * The new-session draft's list of the agent's other sessions in the folder:
 * the button that asks for them, the states while it does, and one row per
 * session that opens it.
 */
export function AgentSessionList({ agentName, state, importError, onLoad, onImport }: AgentSessionListProps) {
  return (
    <div className="space-y-2">
      {state.kind === 'idle' && <Button onClick={onLoad}>Continue a session from {agentName}</Button>}

      {state.kind === 'loading' && (
        <p role="status" className="text-ui text-fg-muted">
          Asking {agentName} for its sessions…
        </p>
      )}

      {state.kind === 'loaded' && (
        <>
          {state.sessions.length === 0 ? (
            <p className="text-ui text-fg-muted">{agentName} has no other sessions in this folder.</p>
          ) : (
            <div>
              <h3 className="px-1 pb-1.5 text-caption font-medium text-fg-muted">
                Or continue one of {agentName}'s sessions in this folder
              </h3>
              <ul className="flex flex-col">
                {state.sessions.map((listed) => (
                  <li key={listed.acpSessionId} className="border-b border-border last:border-b-0">
                    <SessionRow listed={listed} onImport={onImport} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.truncated && <p className="text-caption text-fg-muted">Showing the 200 most recent sessions.</p>}
          {state.incomplete && <p className="text-caption text-fg-muted">Some sessions could not be listed.</p>}
        </>
      )}

      {state.kind === 'failed' && (
        <div className="space-y-2">
          <p role="alert" className="text-ui text-danger">
            {state.message}
          </p>
          <Button onClick={onLoad}>Try again</Button>
        </div>
      )}

      {importError && (
        <p role="alert" className="text-ui text-danger">
          {importError}
        </p>
      )}
    </div>
  );
}