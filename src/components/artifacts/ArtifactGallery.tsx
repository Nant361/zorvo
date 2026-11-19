import { useState, type ReactNode } from "react";
import { PanelLeft, Search } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { ToastStack } from "../ui/Toast";
import { TOP_BAR_TRAFFIC_LIGHT_INSET_PX } from "../TopBar";
import { AgentTile } from "../ui/AgentTile";
import { filterGallery, newestVersion, type GalleryRow } from "../../lib/artifacts";
import { formatRelativeTime } from "../../lib/relative-time";
import { ArtifactMark } from "./ArtifactsPanel";

export interface ArtifactGalleryProps {
  /** Every session's artifacts, the most recently changed first. */
  rows: readonly GalleryRow[];
  /** Selects the session and shows the artifact in its Artifacts tab. */
  onOpen: (sessionId: string, artifactId: string) => void;
  /**
   * Brings the sidebar back; given only while it is hidden. The top bar, which has this button for
   * every other view, is not drawn under the gallery, so without it there would be no way back.
   */
  onShowSidebar?: () => void;
  /** The app's notice, drawn here because the chat that usually shows it is hidden under the gallery. */
  notice?: ReactNode;
}

const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,200px)_96px] items-center gap-4";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Every page every session's agent showed, in the chat's place: find one again by its title. */
export function ArtifactGallery({ rows, onOpen, onShowSidebar, notice }: ArtifactGalleryProps) {
  const [query, setQuery] = useState("");
  const shown = filterGallery(rows, query);
  const sessionCount = new Set(rows.map((row) => row.sessionId)).size;

  return (
    <section aria-label="Artifact gallery" className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-sheet text-ui text-fg">
      <header
        data-tauri-drag-region
        // With the sidebar hidden the window's own buttons float over this header's left end, as over the top bar's.
        style={onShowSidebar ? { paddingLeft: TOP_BAR_TRAFFIC_LIGHT_INSET_PX } : undefined}
        className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4.5"
      >
        {onShowSidebar && (
          <IconButton label="Show sidebar" tone="secondary" onClick={onShowSidebar}>
            <PanelLeft size={14} />
          </IconButton>
        )}
        <h2 className="text-ui font-semibold text-fg">Artifacts</h2>
        <span className="text-ui-sm text-fg-subtle">{`${plural(rows.length, "page")} in ${plural(sessionCount, "session")}`}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-[880px] flex-col gap-3.5">
          <label className="flex h-8.5 items-center gap-2 rounded-lg border border-border-strong bg-ground px-2.5 text-fg-muted focus-within:border-fg-muted">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search artifacts"
              placeholder="Search artifacts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>
          {shown.length === 0 ? (
            <p className="px-3 text-ui text-fg-muted">No artifacts match.</p>
          ) : (
            <>
              <div aria-hidden="true" className={`${COLUMNS} px-3 text-caption text-fg-subtle`}>
                <span>Page and session</span>
                <span>Agent</span>
                <span className="text-right">Updated</span>
              </div>
              <ul aria-label="Artifacts" className="-mt-2 flex flex-col gap-0.5">
                {shown.map((row) => (
                  <li key={`${row.sessionId}/${row.artifact.id}`}>
                    <button
                      type="button"
                      aria-label={`${row.artifact.title}, in ${row.sessionName}`}
                      onClick={() => onOpen(row.sessionId, row.artifact.id)}
                      className={`${COLUMNS} focus-ring w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ArtifactMark />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium text-fg">{row.artifact.title}</span>
                            {row.isArchived && <span className="shrink-0 rounded bg-chip px-1.5 text-caption text-fg-muted">Archived</span>}
                          </span>
                          <span className="truncate text-caption text-fg-subtle">{`${row.sessionName} · Version ${newestVersion(row.artifact)}`}</span>
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-ui-sm text-fg-secondary">
                        <AgentTile profileId={row.profileId} name={row.agentName} size={16} />
                        <span className="truncate">{row.agentName}</span>
                      </span>
                      <span className="text-right text-ui-sm text-fg-subtle">{formatRelativeTime(row.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-2 px-3 text-ui-sm text-fg-subtle">Pages stay on this Mac. Deleting a session deletes its pages.</p>
        </div>
      </div>
      {notice && <ToastStack>{notice}</ToastStack>}
    </section>
  );
}
