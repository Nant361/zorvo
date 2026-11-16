import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { anchorOfPick, marksFor, MAX_ARTIFACT_COMMENTS, parsePagePick, withoutMissingArtifacts } from '../lib/artifact-comments';
import { createId } from '../lib/ids';
import { MAX_COMMENT_LENGTH } from '../lib/review-comments';
import type { Artifact, ArtifactAnchor, ArtifactComment, PageRef, Session } from '../types';
import { enqueueArtifactViewCall } from './useArtifactView';
import { useLatest } from './useLatest';

/** Emitted by the backend when an artifact page reports a pick, a cancel or marks it could not find. */
const ARTIFACT_PAGE_PICK = 'artifact-page-pick';
const COULD_NOT_MARK = 'Zorvo could not mark that page.';
const COULD_NOT_COMMENT = 'Zorvo could not turn comment mode on for that page.';

type ArtifactCommentsChange = (prev: ArtifactComment[]) => ArtifactComment[];

/** What a pick made, waiting for the user's text. It keeps the page it was picked on. */
export interface ArtifactCandidate {
  page: PageRef;
  anchor: ArtifactAnchor;
  /** A newer pick arrived while text was typed here, so it was not taken. */
  isPickHeld: boolean;
}

export interface ArtifactCommentsState {
  sessionId: string;
  comments: readonly ArtifactComment[];
  /** Comment mode is on for the page on screen. */
  isCommenting: boolean;
  setCommenting: (on: boolean) => void;
  /** The session's candidate, whichever version it was picked on. */
  candidate: ArtifactCandidate | null;
  /** Kept outside React state: typing must not redraw `App`. */
  candidateBody: () => string;
  setCandidateBody: (body: string) => void;
  cancelCandidate: () => void;
  saveCandidate: () => 'saved' | 'empty' | 'full';
  /** Numbers the page on screen could not find again. */
  missing: ReadonlySet<number>;
  /** An edited comment is plain again, and leaves the message. */
  editComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;
  /** Removes the artifact's sent comments. */
  clearSent: (artifactId: string) => void;
}

const keyOf = (page: PageRef | null) => (page === null ? null : `${page.sessionId}/${page.artifactId}/${page.version}`);
const NO_NUMBERS: ReadonlySet<number> = new Set();

function failure(error: unknown, fallback: string): string {
  return typeof error === 'string' && error !== '' ? error : fallback;
}

function plain(comment: ArtifactComment, body: string): ArtifactComment {
  const { sentAt: _sentAt, ...rest } = comment;
  return { ...rest, body };
}

/**
 * The comments of the session on screen and what its artifact page reports.
 * Picks count only for the page on screen while comment mode is on; marks go
 * to that page whenever its comments change. Main window only.
 */
export function useArtifactComments({
  sessionId,
  comments,
  update,
  shownPage,
  forget,
  onError,
}: {
  sessionId: string | undefined;
  comments: readonly ArtifactComment[] | undefined;
  update: (sessionId: string, change: ArtifactCommentsChange) => void;
  /** Null unless the viewer shows a page of the session on screen. */
  shownPage: PageRef | null;
  forget: (ids: readonly string[]) => void;
  onError: (message: string) => void;
}): ArtifactCommentsState {
  const session = sessionId ?? '';
  const list = comments ?? [];
  const shownKey = keyOf(shownPage);
  const [commenting, setCommentingPage] = useState<string | null>(null);
  // Another page on screen (another artifact, version or session) starts with comment mode off.
  const [lastShownKey, setLastShownKey] = useState(shownKey);
  if (lastShownKey !== shownKey) {
    setLastShownKey(shownKey);
    setCommentingPage(null);
  }
  const isCommenting = commenting !== null && commenting === shownKey;

  const [candidates, setCandidates] = useState<Readonly<Record<string, ArtifactCandidate>>>({});
  const bodies = useRef<Record<string, string>>({});
  const candidate = candidates[session] ?? null;

  const marks = shownPage ? marksFor(list, shownPage.artifactId, shownPage.version) : [];
  const marksKey = shownPage ? `${shownKey}|${JSON.stringify(marks)}` : null;
  const [missing, setMissing] = useState<{ key: string; numbers: ReadonlySet<number> } | null>(null);

  const latest = useLatest({ shownPage, shownKey, isCommenting, marksKey });

  const dropCandidate = (owner: string) => {
    delete bodies.current[owner];
    setCandidates((prev) => {
      if (!(owner in prev)) return prev;
      const next = { ...prev };
      delete next[owner];
      return next;
    });
  };
  const dropCandidateRef = useLatest(dropCandidate);

  useEffect(() => {
    let isGone = false;
    const unlisten = listen<unknown>(ARTIFACT_PAGE_PICK, (event) => {
      if (isGone) return;
      const pick = parsePagePick(event.payload);
      const now = latest.current;
      if (pick === null || keyOf(pick.page) !== now.shownKey) return;
      const { page, message } = pick;
      if (message.kind === 'marks-missing') {
        if (now.marksKey !== null) setMissing({ key: now.marksKey, numbers: new Set(message.numbers) });
        return;
      }
      if (!now.isCommenting) return;
      const hasText = (bodies.current[page.sessionId] ?? '').trim() !== '';
      if (message.kind === 'cancel') {
        if (!hasText) dropCandidateRef.current(page.sessionId);
        return;
      }
      const anchor = anchorOfPick(message);
      if (anchor === null) return;
      setCandidates((prev) => {
        const current = prev[page.sessionId];
        if (current && hasText) return { ...prev, [page.sessionId]: { ...current, isPickHeld: true } };
        bodies.current[page.sessionId] = '';
        return { ...prev, [page.sessionId]: { page, anchor, isPickHeld: false } };
      });
    });
    return () => {
      isGone = true;
      void unlisten.then((stop) => stop());
    };
  }, [latest, dropCandidateRef]);

  const pageRef = useLatest(shownPage);
  const marksRef = useLatest(marks);
  const onErrorRef = useLatest(onError);
  useEffect(() => {
    const page = pageRef.current;
    if (marksKey === null || page === null) return;
    const sent = marksRef.current;
    enqueueArtifactViewCall(
      () => invoke('artifact_view_marks', { sessionId: page.sessionId, artifactId: page.artifactId, version: page.version, marks: sent }),
      (error) => onErrorRef.current(failure(error, COULD_NOT_MARK)),
    );
  }, [marksKey, pageRef, marksRef, onErrorRef]);

  const setCommenting = (on: boolean) => {
    if (shownPage === null) return;
    setCommentingPage(on ? shownKey : null);
    const page = shownPage;
    enqueueArtifactViewCall(
      () => invoke('artifact_comment_mode', { sessionId: page.sessionId, artifactId: page.artifactId, version: page.version, on }),
      (error) => onErrorRef.current(failure(error, COULD_NOT_COMMENT)),
    );
  };

  const saveCandidate = (): 'saved' | 'empty' | 'full' => {
    const waiting = candidates[session];
    const body = (bodies.current[session] ?? '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (!waiting || body === '') return 'empty';
    if (list.length >= MAX_ARTIFACT_COMMENTS) return 'full';
    const comment: ArtifactComment = {
      id: createId('ac'),
      artifactId: waiting.page.artifactId,
      version: waiting.page.version,
      anchor: waiting.anchor,
      body,
      createdAt: Date.now(),
    };
    update(session, (prev) => [...prev, comment]);
    dropCandidate(session);
    return 'saved';
  };

  const missingNow = missing !== null && missing.key === marksKey ? missing.numbers : NO_NUMBERS;

  return {
    sessionId: session,
    comments: list,
    isCommenting,
    setCommenting,
    candidate,
    candidateBody: () => bodies.current[session] ?? '',
    setCandidateBody: (body) => {
      bodies.current[session] = body;
    },
    cancelCandidate: () => dropCandidate(session),
    saveCandidate,
    missing: missingNow,
    editComment: (id, body) => {
      const text = body.trim().slice(0, MAX_COMMENT_LENGTH);
      if (text === '') return;
      forget([id]);
      update(session, (prev) => prev.map((comment) => (comment.id === id ? plain(comment, text) : comment)));
    },
    deleteComment: (id) => {
      forget([id]);
      update(session, (prev) => prev.filter((comment) => comment.id !== id));
    },
    clearSent: (artifactId) =>
      update(session, (prev) => prev.filter((comment) => comment.artifactId !== artifactId || comment.sentAt === undefined)),
  };
}

/**
 * Removes the comments of artifacts that are gone, for every session whose
 * artifacts were read without failure, and takes them out of the message.
 */
export function useArtifactCommentSweep(
  sessions: readonly Session[],
  bySession: ReadonlyMap<string, readonly Artifact[]>,
  readSessions: ReadonlySet<string>,
  update: (sessionId: string, change: ArtifactCommentsChange) => void,
  forget: (ids: readonly string[]) => void,
): void {
  const updateRef = useLatest(update);
  const forgetRef = useLatest(forget);
  useEffect(() => {
    for (const session of sessions) {
      const comments = session.artifactComments;
      const artifacts = bySession.get(session.id);
      if (!comments || comments.length === 0 || !artifacts || !readSessions.has(session.id)) continue;
      const kept = withoutMissingArtifacts(comments, artifacts);
      if (kept === comments) continue;
      const keptIds = new Set(kept.map((comment) => comment.id));
      forgetRef.current(comments.filter((comment) => !keptIds.has(comment.id)).map((comment) => comment.id));
      updateRef.current(session.id, (prev) => withoutMissingArtifacts(prev, artifacts));
    }
  }, [sessions, bySession, readSessions, updateRef, forgetRef]);
}
