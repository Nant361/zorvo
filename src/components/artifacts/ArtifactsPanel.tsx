import { ChevronRight, FileText, PanelsTopLeft } from "lucide-react";
import { newestVersion, shownArtifactOf, type ViewedArtifact } from "../../lib/artifacts";
import { fileNameAndFolder, pathInFolder, type CreatedFile } from "../../lib/created-files";
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
  /** The files the agent created in this session, the newest first, listed under the pages. */
  files?: readonly CreatedFile[];
  /** The agent's name, for the empty tab. */
  agentName?: string;
  /** The folder the file viewer shows, which a created file must be inside to open there. */
  filesRoot?: string;
  /** Opens a created file in the file viewer; given its path inside `filesRoot`. */
  onOpenFile?: (relative: string) => void;
}

/** The mark every artifact row and card carries. */
export function ArtifactMark() {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-fg-secondary">
      <PanelsTopLeft size={14} />
    </span>
  );
}

/** The mark of a created file's row. */
function FileMark() {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chip text-fg-secondary">
      <FileText size={14} />
    </span>
  );
}

const ROW = "flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left";

/** A created file: it opens in the file viewer when it is inside the session's folder, else it is only named. */
function CreatedFileRow({ file, root, onOpenFile }: { file: CreatedFile; root?: string; onOpenFile?: (relative: string) => void }) {
  const { name, where } = fileNameAndFolder(file.path, root ?? "");
  const relative = root ? pathInFolder(file.path, root) : null;
  const content = (
    <>
      <FileMark />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-fg">{name}</span>
        <span className="truncate text-caption text-fg-subtle">
          {[where ? `New file · ${where}` : "New file", formatRelativeTime(file.at)].join(" · ")}
        </span>
      </span>
    </>
  );
  if (relative === null || !onOpenFile) {
    return (
      <div title={file.path} className={ROW}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" title={file.path} onClick={() => onOpenFile(relative)} className={`focus-ring ${ROW} transition-colors hover:bg-surface-hover`}>
      {content}
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
    </button>
  );
}

/** The Output tab: the pages this session's agent showed, one of them open, and the files it created. */
export function ArtifactsPanel({
  sessionId,
  artifacts,
  viewed,
  onView,
  isExpanded,
  onToggleExpanded,
  onError,
  comments,
  addReview,
  cwd,
  files = [],
  agentName = "The agent",
  filesRoot,
  onOpenFile,
}: ArtifactsPanelProps) {
  // A single page opens by itself, unless files are listed beside it.
  const isOnly = artifacts.length === 1 && files.length === 0;
  const open = shownArtifactOf(artifacts, viewed, files.length);

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

  if (artifacts.length === 0 && files.length === 0) {
    return (
      <p className="px-4 py-3.5 text-ui-sm text-fg-muted">
        {`Nothing yet. Pages and files ${agentName} makes in this session show here.`}
      </p>
    );
  }

  return (
    <ul aria-label="Output" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2.5">
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
      {files.map((file) => (
        <li key={file.path}>
          <CreatedFileRow file={file} root={filesRoot} onOpenFile={onOpenFile} />
        </li>
      ))}
    </ul>
  );
}
