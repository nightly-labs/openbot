import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";

/**
 * The mailbox key that makes a retried tool call enqueue its message once.
 * Providers choose the thread and call ids, and a custom ACP thread id alone can fill half the identifier
 * limit, so a key that would pass the limit replaces the thread and call ids with their digest.
 * The turn id stays the second-to-last segment, because the mailbox reads it back to place the message
 * in the turn that sent it.
 */
export function toolCallIdempotencyKey(params: { threadId: string; turnId: string; callId: string }): string {
  const key = `${params.threadId}:${params.turnId}:${params.callId}`;
  if (key.length <= INPUT_LIMITS.identifier) return key;
  const digest = createHash("sha256")
    .update(JSON.stringify([params.threadId, params.callId]))
    .digest("hex");
  return `${digest}:${params.turnId}:tool-call`;
}
