import type { ArtifactCard, ChatMessage } from '../types';
import { openReplyIndex, withOpenReply, type AcpReducerContext } from './acp-events';
import type { ShownArtifact } from './artifacts';

/**
 * Marks in the chat where the agent showed a page: on its open reply, or on a
 * new agent message when that reply already carries a card, so each version
 * shown keeps a row of its own.
 */
export function withArtifactCard(messages: ChatMessage[], shown: ShownArtifact, ctx: AcpReducerContext): ChatMessage[] {
  const card: ArtifactCard = { artifactId: shown.artifact.id, title: shown.artifact.title, version: shown.version };
  const open = messages[openReplyIndex(messages)];
  if (open?.artifactCard) {
    return [...messages, { id: ctx.createId('msg'), role: 'agent', content: '', timestamp: ctx.now, artifactCard: card }];
  }
  return withOpenReply(messages, ctx, (reply) => ({ ...reply, artifactCard: card }));
}
