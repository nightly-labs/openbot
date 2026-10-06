import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";

/**
 * Frozen optional message-client-id-v1 contract: `POST /v1/agents/:agentId/messages` may carry a
 * `clientMessageId` identifier beside the frozen keys, on protocol 5 and later. A second request with
 * the same id, from the same member to the same agent within a day, is answered with the first
 * receipt and stores nothing. A host without the capability drops the key, so a client retries a lost reply only when
 * the host advertises it. Widening any of it needs a second capability string.
 */
export const TEAM_MESSAGE_CLIENT_ID_CAPABILITY = "message-client-id-v1";

/** The `clientMessageId` of a message request, read off the raw body. A malformed one fails closed. */
export function decodeMessageClientId(source: unknown): { clientMessageId?: string } {
  if (!isDynamicRecord(source) || source.clientMessageId === undefined) return {};
  if (!isIdentifier(source.clientMessageId)) throw new Error("Invalid client message id.");
  return { clientMessageId: source.clientMessageId };
}
