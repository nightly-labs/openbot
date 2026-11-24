import { SIGNED_OUT_CHANNEL_MEMBER_ID } from "@openbot/contracts/ipc";

export interface ReaderIdentity {
  memberId: string | null;
  accountUserId: string | null;
  onOwnComputer: boolean;
}

export function isReaderAuthor(authorId: string, reader: ReaderIdentity): boolean {
  if (authorId === SIGNED_OUT_CHANNEL_MEMBER_ID) return reader.onOwnComputer;
  if (reader.memberId !== null && authorId === reader.memberId) return true;
  return reader.accountUserId !== null && authorId === `local-user:${reader.accountUserId}`;
}
