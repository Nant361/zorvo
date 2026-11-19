import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "../ui/Button";
import {
  anchorSummary,
  artifactCommentStatus,
  commentNumbers,
  isCountedArtifact,
  type CheckedArtifactComment,
} from "../../lib/artifact-comments";
import { newestVersion } from "../../lib/artifacts";
import type { ArtifactCommentsState } from "../../hooks/useArtifactComments";
import type { AddArtifactReview } from "../../hooks/useReviewWiring";
import type { Artifact, ArtifactComment } from "../../types";

export interface ArtifactCommentStripProps {
  artifact: Artifact;
  /** The version the viewer shows. */
  shownVersion: number;
  /** The session's folder, for the source path in the message. */
  cwd: string;
  comments: ArtifactCommentsState;
  addReview: AddArtifactReview;
}

const FULL = "This session has 200 artifact comments. Delete some, or clear the sent ones.";
const HELD = "Finish or cancel this comment first.";

function NumberBadge({ n, isOutline }: { n: number; isOutline?: boolean }) {
  const look = isOutline ? "text-mark ring-1 ring-mark ring-inset" : "bg-mark text-on-mark";
  return (
    <span aria-hidden="true" className={`inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-caption font-semibold ${look}`}>
      {n}
    </span>
  );
}

function statusWord(comment: ArtifactComment, isCurrent: boolean, isInMessage: boolean): string {
  if (isInMessage) return "In message";
  if (comment.sentAt !== undefined) return "Sent";
  return isCurrent ? "Current" : "Outdated";
}

/** What a pick made: where it is, the text box, Save comment and Cancel. */
function CandidateBox({ comments, number }: { comments: ArtifactCommentsState; number: number }) {
  const candidate = comments.candidate!;
  const [body, setBody] = useState(comments.candidateBody);
  const [isFull, setIsFull] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const summary = anchorSummary(candidate.anchor);
  // The page had the keyboard while the user picked: take it, on a new pick and on a refused one,
  // so what they type next is the comment and never reaches the page.
  useEffect(() => {
    boxRef.current?.focus();
  }, [candidate.isPickHeld]);
  const save = () => {
    const outcome = comments.saveCandidate();
    setIsFull(outcome === "full");
  };
  return (
    <div className="mx-2 mt-2 flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
      <label className="flex flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-caption">
          <NumberBadge n={number} isOutline />
          <span className="text-fg-muted">Comment on</span>
          <span className="truncate font-medium text-fg-secondary">{summary}</span>
        </span>
        <textarea
          ref={boxRef}
          rows={2}
          value={body}
          aria-label={`Comment on ${summary}`}
          onChange={(event) => {
            setBody(event.target.value);
            comments.setCandidateBody(event.target.value);
          }}
          className="focus-ring resize-none rounded-md border border-border-strong bg-ground px-2 py-1.5 text-ui text-fg"
        />
      </label>
      {candidate.isPickHeld && <span role="status" className="text-caption text-status-attention">{HELD}</span>}
      {isFull && <span role="status" className="text-caption text-fg-muted">{FULL}</span>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={comments.cancelCandidate}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={body.trim() === ""} onClick={save}>
          Save comment
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  checked: CheckedArtifactComment;
  word: string;
  note?: string;
  isMissing: boolean;
  canAdd: boolean;
  blockedReason: string | undefined;
  onAdd: () => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
}

/** One saved comment: its number, where it is, its status, its text, and what can be done with it. */
function CommentRow({ checked, word, note, isMissing, canAdd, blockedReason, onAdd, onEdit, onDelete }: RowProps) {
  const { comment, number } = checked;
  const [draft, setDraft] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const isOutdated = checked.status === "outdated";
  const addLabel = comment.sentAt !== undefined ? "Add again" : "Add to message";
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-caption">
        <NumberBadge n={number} isOutline={isOutdated} />
        <span className="truncate font-medium text-fg-secondary">{anchorSummary(comment.anchor)}</span>
        <span className="shrink-0 text-fg-subtle">{`· ${word}${isMissing ? " · Not found on the page" : ""}`}</span>
      </div>
      {note && <span className="text-caption text-status-attention">{note}</span>}
      {draft === null ? (
        <span className="whitespace-pre-wrap break-words text-ui text-fg-secondary">{comment.body}</span>
      ) : (
        <textarea
          rows={2}
          value={draft}
          aria-label={`Edit comment ${number}`}
          onChange={(event) => setDraft(event.target.value)}
          className="focus-ring resize-none rounded-md border border-border-strong bg-ground px-2 py-1.5 text-ui text-fg"
        />
      )}
      {isAsking ? (
        <div role="alertdialog" aria-label={`Delete comment ${number}`} className="flex items-center justify-end gap-2">
          <span className="mr-auto text-ui text-fg">Delete this comment?</span>
          <Button variant="ghost" size="sm" onClick={() => setIsAsking(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" aria-label="Delete comment" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : draft !== null ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={draft.trim() === ""}
            onClick={() => {
              onEdit(draft);
              setDraft(null);
            }}
          >
            Save
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" tone="muted" onClick={() => setDraft(comment.body)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" tone="muted" onClick={() => setIsAsking(true)}>
            Delete
          </Button>
          {canAdd && (
            <Button variant="outline" size="sm" disabled={blockedReason !== undefined} title={blockedReason} onClick={onAdd}>
              {addLabel}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The comments of one artifact, under its page: the comment being written, the
 * saved ones by number (the same numbers the page draws), and Add N to message.
 * It sits under the page's box, never over it, so the page never has to hide.
 */
export function ArtifactCommentStrip({ artifact, shownVersion, cwd, comments, addReview }: ArtifactCommentStripProps) {
  const numbers = commentNumbers(comments.comments, artifact.id);
  const newest = newestVersion(artifact);
  const checked: CheckedArtifactComment[] = comments.comments
    .filter((comment) => comment.artifactId === artifact.id)
    .map((comment) => ({ comment, number: numbers.get(comment.id) ?? 0, status: artifactCommentStatus(comment, artifact) }))
    .sort((a, b) => a.number - b.number);
  const candidate = comments.candidate?.page.artifactId === artifact.id ? comments.candidate : null;
  if (!comments.isCommenting && checked.length === 0 && candidate === null) return null;

  const counted = checked.filter(({ comment, status }) => isCountedArtifact(comment, status, addReview.inMessage));
  const hasSent = checked.some(({ comment }) => comment.sentAt !== undefined);
  const nextNumber = checked.reduce((top, { number }) => Math.max(top, number), 0) + 1;
  const add = (picked: CheckedArtifactComment[]) => addReview.add(picked, artifact, cwd);
  const word = counted.length === 1 ? "comment" : "comments";

  return (
    <section aria-label="Comments on this page" className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-t border-border bg-sheet">
      {candidate && (
        <CandidateBox key={`${candidate.page.version}:${JSON.stringify(candidate.anchor)}`} comments={comments} number={nextNumber} />
      )}
      <ol aria-label="Comments" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
        {checked.map((entry) => {
          const isInMessage = addReview.inMessage.has(entry.comment.id);
          const isCurrent = entry.status === "current";
          return (
            <CommentRow
              key={entry.comment.id}
              checked={entry}
              word={statusWord(entry.comment, isCurrent, isInMessage)}
              note={isCurrent ? undefined : `Written on Version ${entry.comment.version}; the page is now Version ${newest}.`}
              isMissing={entry.comment.version === shownVersion && comments.missing.has(entry.number)}
              canAdd={!isInMessage}
              blockedReason={addReview.blockedReason}
              onAdd={() => add([entry])}
              onEdit={(body) => comments.editComment(entry.comment.id, body)}
              onDelete={() => comments.deleteComment(entry.comment.id)}
            />
          );
        })}
      </ol>
      {(counted.length > 0 || hasSent) && (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-border py-2 pr-2 pl-3">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />
            <span className="flex-1 text-ui text-fg-secondary">{`${counted.length} ${word} not in a message`}</span>
            {hasSent && (
              <Button variant="ghost" size="sm" tone="muted" onClick={() => comments.clearSent(artifact.id)}>
                Clear sent
              </Button>
            )}
            {counted.length > 0 && (
              <Button variant="outline" size="sm" disabled={addReview.blockedReason !== undefined} onClick={() => add(counted)}>
                {`Add ${counted.length} to message`}
              </Button>
            )}
          </div>
          {addReview.blockedReason && <span className="text-caption text-fg-muted">{addReview.blockedReason}</span>}
        </div>
      )}
    </section>
  );
}
