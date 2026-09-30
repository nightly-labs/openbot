import { SIGNED_OUT_CHANNEL_MEMBER_ID } from "@openbot/contracts/ipc";

/**
 * Who the reader is, as the three ids a message can carry for them: a channel author, or the
 * sender the host stamps on an agent chat message.
 */
export interface ReaderIdentity {
  /** The reader's id in the team roster, or null while the roster holds none for them. */
  memberId: string | null;
  /** The account the reader signed in to, or null while they are signed out. */
  accountUserId: string | null;
  /** True while the reader reads a chat on their own computer, not on a server they joined. */
  onOwnComputer: boolean;
}

/**
 * Does this author id stand for the reader?
 *
 * A message the host user wrote before they signed in carries the signed-out id. It is the same
 * person, so it stays their own message, the way its read cursor stays their read cursor. That
 * holds on their own computer alone: on a server they joined, the signed-out id is the host, who is
 * another person.
 */
export function isReaderAuthor(authorId: string, reader: ReaderIdentity): boolean {
  if (authorId === SIGNED_OUT_CHANNEL_MEMBER_ID) return reader.onOwnComputer;
  if (reader.memberId !== null && authorId === reader.memberId) return true;
  return reader.accountUserId !== null && authorId === `local-user:${reader.accountUserId}`;
}
