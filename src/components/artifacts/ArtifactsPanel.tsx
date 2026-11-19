import { ChevronRight, PanelsTopLeft } from "lucide-react";
import { newestVersion, shownArtifactOf, type ViewedArtifact } from "../../lib/artifacts";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import type { Artifact } from "../../types";
import { ArtifactViewer } from "./ArtifactViewer";

export interface ArtifactsPanelProps {
  sessionId: string;
  /** The session's artifacts, the most recently changed first. */
  artifacts: readonly Artifact[];
  /** The artifact the viewer shows; null shows the list (or the only artifact). */
  viewed: ViewedArtifact | null;
  onView: (view: ViewedArtifact | null) => void;
  /** The page takes the chat's place. */
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string) => void;
  /** The session's artifact comments, main window only. */
  comments?: ArtifactCommentsState;
  addReview?: AddArtifactReview;
  cwd?: string;
}

/** The mark every artifact row and card carries. */
export function ArtifactMark() {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-fg-secondary">
      <PanelsTopLeft size={14} />
    </span>
  );
}

/** The Artifacts tab: the pages this session's agent showed, and one of them open. */
export function ArtifactsPanel({ sessionId, artifacts, viewed, onView, isExpanded, onToggleExpanded, onError, comments, addReview, cwd }: ArtifactsPanelProps) {
  const isOnly = artifacts.length === 1;
  const open = shownArtifactOf(artifacts, viewed);

  if (open) {
    return (
      <ArtifactViewer
        // Another artifact starts with its menus closed and its own reload count.
        key={open.id}
        sessionId={sessionId}
        artifact={open}
        version={viewed?.version ?? null}
        onBack={isOnly ? undefined : () => onView(null)}
        onView={onView}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onError={onError}
        comments={comments}
        addReview={addReview}
        cwd={cwd}
      />
    );
  }

  return (
    <ul aria-label="Artifacts" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2.5">
      {artifacts.map((artifact) => {
        const newest = newestVersion(artifact);
        const at = artifact.versions.find((version) => version.n === newest)?.at ?? 0;
        return (
          <li key={artifact.id}>
            <button
              type="button"
              onClick={() => onView({ artifactId: artifact.id, version: null })}
              className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left transition-colors hover:bg-surface-hover"
            >
              <ArtifactMark />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui text-fg">{artifact.title}</span>
                <span className="truncate text-caption text-fg-subtle">{`Version ${newest} · ${formatRelativeTime(at)}`}</span>
              </span>
              <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
