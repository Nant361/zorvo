import { useEffect, useRef, useState } from 'react';
import type { ReviewTarget } from '../types';

/** Which session the comments added to the composer are for. */
export interface ReviewSlot {
  sessionId: string;
  commentIds: readonly string[];
  /** Artifact comments in the message; absent while there are none, so a diff-only slot keeps its shape. */
  artifactCommentIds?: readonly string[];
  /** The diff target of the last add, or null when the last add was an artifact's. */
  lastTarget: ReviewTarget | null;
  /** The artifact of the last add, while that add was an artifact's; a diff add clears it. */
  lastArtifactId?: string;
}

export interface ReviewMessage {
  slot: ReviewSlot | null;
  /** Comments in the message, for the active session only. */
  inMessage: ReadonlySet<string>;
  /** Artifact comments in the message, for the active session only. */
  inMessageArtifact: ReadonlySet<string>;
  /** The composer holds comments for another session, or none is on screen. */
  blocksSend: boolean;
  /** The composer holds another session's comments, so nothing of `sessionId`'s may join them. */
  isHeldFor: (sessionId: string) => boolean;
  /** Call it after the text went into the composer, so a composer that took nothing leaves no slot. */
  add: (sessionId: string, ids: readonly string[], target: ReviewTarget) => void;
  /** The same for one artifact's comments; diff ids already in the slot stay. */
  addArtifact: (sessionId: string, ids: readonly string[], artifactId: string) => void;
  /** The composer's text already has `heading` only after an add for this session and target, and only while it still holds it. */
  needsHeading: (sessionId: string, target: ReviewTarget, heading: string) => boolean;
  /** An artifact's heading is needed unless the last add was this artifact's, for this session, and the composer still holds it. */
  needsArtifactHeading: (sessionId: string, artifactId: string, heading: string) => boolean;
  /** Takes edited or deleted comments, of either kind, out. The slot stays, since their text stays in the composer. */
  forget: (ids: readonly string[]) => void;
  /** Lifts the slot when no text is left: `handleSend` sends nothing for spaces, so they count as empty. */
  onComposerText: (text: string) => void;
  /** Restored text replaced the comments, which lifts the slot, unless it is the text they just went out in. */
  onComposerRestored: (text: string) => void;
  /** `text` came back to `sessionId`'s composer beside what is there, so a slot stays; it re-arms one for what just went out. */
  onComposerGivenBack: (sessionId: string, text: string) => void;
  /** Marks the slot's comments Sent and clears it, when `text` went to the slot's session. */
  sendFrom: (sessionId: string, text: string) => void;
  /** Puts back the slot of a message that was held (a secret review) before it could be sent. */
  rearm: (slot: ReviewSlot) => void;
}

/** Whether `block` stands alone in `text`: at either end or between blank lines, as messages given back together are joined. */
const holdsBlock = (text: string, block: string) => `\n\n${text}\n\n`.includes(`\n\n${block}\n\n`);

/** A slot, without the artifact fields while they are empty. */
function slotOf(
  sessionId: string,
  commentIds: readonly string[],
  artifactCommentIds: readonly string[],
  lastTarget: ReviewTarget | null,
  lastArtifactId?: string,
): ReviewSlot {
  return {
    sessionId,
    commentIds,
    ...(artifactCommentIds.length > 0 ? { artifactCommentIds } : {}),
    lastTarget,
    ...(lastArtifactId === undefined ? {} : { lastArtifactId }),
  };
}

const union = (kept: readonly string[], added: readonly string[]) => [...new Set([...kept, ...added])];

/**
 * One composer serves every session and keeps its text across a switch, so this remembers whom
 * added comments are for. In memory only, as composer text is: after a restart they are plain comments.
 */
export function useReviewMessage({ activeSessionId, markSent, markArtifactSent, sessionIds }: {
  activeSessionId: string | undefined;
  markSent: (sessionId: string, ids: readonly string[]) => void;
  /** Called on Send only when the slot holds artifact comments. */
  markArtifactSent?: (sessionId: string, ids: readonly string[]) => void;
  /** Every session that still exists: what is kept for any other is dropped. */
  sessionIds: readonly string[];
}): ReviewMessage {
  const [slot, setSlot] = useState<ReviewSlot | null>(null);
  // Read only for the heading, which says quoted lines are not instructions: replacing the text keeps the slot.
  const composerText = useRef('');
  // A message that did not reach the agent comes back holding its comments, already marked Sent: this says
  // whom it is still for. By session, as one may wait in memory while another session sends.
  const lastSends = useRef(new Map<string, Pick<ReviewSlot, 'lastTarget'> & { text: string }>());
  const isActiveSessions = slot !== null && slot.sessionId === activeSessionId;

  useEffect(() => {
    for (const sessionId of lastSends.current.keys()) {
      if (!sessionIds.includes(sessionId)) lastSends.current.delete(sessionId);
    }
  });

  return {
    slot,
    inMessage: new Set(isActiveSessions ? slot.commentIds : []),
    inMessageArtifact: new Set(isActiveSessions ? (slot.artifactCommentIds ?? []) : []),
    blocksSend: slot !== null && !isActiveSessions,
    isHeldFor: (sessionId) => slot !== null && slot.sessionId !== sessionId,
    add: (sessionId, ids, target) =>
      setSlot((prev) => {
        const kept = prev?.sessionId === sessionId ? prev : null;
        return slotOf(sessionId, union(kept?.commentIds ?? [], ids), kept?.artifactCommentIds ?? [], target);
      }),
    // The last add decides the heading: an artifact's add ends the diff's run of blocks, and a diff add the artifact's.
    addArtifact: (sessionId, ids, artifactId) =>
      setSlot((prev) => {
        const kept = prev?.sessionId === sessionId ? prev : null;
        return slotOf(sessionId, kept?.commentIds ?? [], union(kept?.artifactCommentIds ?? [], ids), null, artifactId);
      }),
    needsHeading: (sessionId, target, heading) =>
      slot?.sessionId !== sessionId || slot.lastTarget !== target || !composerText.current.includes(heading),
    needsArtifactHeading: (sessionId, artifactId, heading) =>
      slot?.sessionId !== sessionId || slot.lastArtifactId !== artifactId || !composerText.current.includes(heading),
    forget: (ids) =>
      setSlot(
        (prev) =>
          prev &&
          slotOf(
            prev.sessionId,
            prev.commentIds.filter((id) => !ids.includes(id)),
            (prev.artifactCommentIds ?? []).filter((id) => !ids.includes(id)),
            prev.lastTarget,
            prev.lastArtifactId,
          ),
      ),
    onComposerText: (text) => {
      composerText.current = text;
      if (text.trim() === '') setSlot(null);
    },
    onComposerRestored: (text) => {
      const owner = [...lastSends.current].find(([, sent]) => sent.text === text);
      if (!owner) {
        setSlot(null);
        return;
      }
      const [sessionId, { lastTarget }] = owner;
      lastSends.current.delete(sessionId);
      setSlot({ sessionId, commentIds: [], lastTarget });
    },
    onComposerGivenBack: (sessionId, text) => {
      const sent = lastSends.current.get(sessionId);
      if (!sent?.text || !holdsBlock(text, sent.text)) return;
      lastSends.current.delete(sessionId);
      // A slot here keeps its comments.
      setSlot((prev) => prev ?? { sessionId, commentIds: [], lastTarget: sent.lastTarget });
    },
    sendFrom: (sessionId, text) => {
      if (slot?.sessionId !== sessionId) return;
      markSent(sessionId, slot.commentIds);
      if (slot.artifactCommentIds && slot.artifactCommentIds.length > 0) markArtifactSent?.(sessionId, slot.artifactCommentIds);
      lastSends.current.set(sessionId, { text, lastTarget: slot.lastTarget });
      setSlot(null);
    },
    rearm: (slot) => setSlot(slot),
  };
}
