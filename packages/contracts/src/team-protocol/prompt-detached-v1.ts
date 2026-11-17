import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

/**
 * Frozen optional prompt-detached-v1 contract: a question that no turn waits for. The provider could
 * not wait longer for the answer (Cursor stops a tool call after 60 seconds), so the host answered the
 * call and keeps the question open; the answer goes to the agent as a new message (#6230). It adds
 * `detached: true` beside the frozen keys of:
 *
 * - a `prompt` event;
 * - each `pendingPrompts` item in the `snapshot` of a `runtime-snapshot` event.
 *
 * A client keeps such a card when its turn ends, as the desktop on the host does. Without it, a joined
 * server's client removed the card at the end of the turn and showed it again, empty, from the next
 * snapshot, so the user lost what they typed (#11188). The host adds it only for a client that
 * advertises the capability, on protocol 9, so the wire of every released client stays as it was. A host
 * without the capability never sends `detached`, so a client accepts it whenever it is present. A present
 * value that is not `true` fails closed. Only `true` goes out. Widening any of it needs a second
 * capability string.
 */
export const TEAM_PROMPT_DETACHED_CAPABILITY = "prompt-detached-v1";

function isJsonObject(value: TeamProtocolV8BaseJsonValue | undefined): value is TeamProtocolV8BaseJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `projected` with the flag of `source`. The host passes `sending`, so a bad value stays on the host. */
function withDetached(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending: boolean,
): TeamProtocolV8BaseJsonValue {
  if (!isJsonObject(projected) || !isDynamicRecord(source) || source.detached === undefined) return projected;
  if (source.detached === true) return { ...projected, detached: true };
  if (sending) return projected;
  throw new Error("Invalid detached prompt flag.");
}

/**
 * `projected`, a `prompt` or `runtime-snapshot` event after the frozen projection, with the `detached`
 * flag of each question of `source`, the event before it. The projection keeps the snapshot's questions
 * in order, so the question at the same index with the same `requestId` is the source.
 */
export function withEventPromptDetached(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isJsonObject(projected) || !isDynamicRecord(source)) return projected;
  if (projected.type === "prompt") return withDetached(projected, source, sending);
  if (projected.type !== "runtime-snapshot") return projected;
  const { snapshot } = projected;
  const from = source.snapshot;
  if (!isJsonObject(snapshot) || !Array.isArray(snapshot.pendingPrompts) || !isDynamicRecord(from)) return projected;
  const sourcePrompts: unknown[] = Array.isArray(from.pendingPrompts) ? from.pendingPrompts : [];
  const pendingPrompts = snapshot.pendingPrompts.map((prompt, index) => {
    const item = sourcePrompts[index];
    return isJsonObject(prompt) && isDynamicRecord(item) && item.requestId === prompt.requestId
      ? withDetached(prompt, item, sending)
      : prompt;
  });
  return { ...projected, snapshot: { ...snapshot, pendingPrompts } };
}
