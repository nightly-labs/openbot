import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";

export function toolCallIdempotencyKey(params: { threadId: string; turnId: string; callId: string }): string {
  const key = `${params.threadId}:${params.turnId}:${params.callId}`;
  if (key.length <= INPUT_LIMITS.identifier) return key;
  const digest = createHash("sha256")
    .update(JSON.stringify([params.threadId, params.callId]))
    .digest("hex");
  return `${digest}:${params.turnId}:tool-call`;
}
