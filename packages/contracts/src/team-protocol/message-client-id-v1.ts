import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";

export const TEAM_MESSAGE_CLIENT_ID_CAPABILITY = "message-client-id-v1";

export function decodeMessageClientId(source: unknown): { clientMessageId?: string } {
  if (!isDynamicRecord(source) || source.clientMessageId === undefined) return {};
  if (!isIdentifier(source.clientMessageId)) throw new Error("Invalid client message id.");
  return { clientMessageId: source.clientMessageId };
}
