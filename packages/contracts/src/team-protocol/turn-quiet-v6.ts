import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV6BaseJsonValue } from "./v6-base";

/**
 * `quiet` rides beside the frozen `turn-completed` projection, in the way `plan`, `senderMember` and
 * `uiBlock` ride beside the frozen conversation projection: the shipped key list drops it, so a client
 * on protocol 1-5, or a v6 client that predates it, reads a completed turn as before and can show a
 * notification for it. Only the current v6 adapter carries the flag, so no protocol bump and no
 * capability are needed: a peer that does not know it loses only the silence.
 *
 * `quiet` marks a scheduled routine run that had nothing to report and posted no message. Only `true`
 * is a value; the host leaves the key out otherwise. The projection removes the key, so an unchecked
 * value would reach the client as a flag the contract never allowed. Fail closed instead, as
 * `withConversationPlans` does: any other present value is a protocol error.
 */
export function withQuietTurn(projected: TeamProtocolV6BaseJsonValue, source: unknown): TeamProtocolV6BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "turn-completed") return projected;
  if (!isDynamicRecord(source) || source.quiet === undefined) return projected;
  if (source.quiet !== true) throw new Error("Invalid quiet turn marker.");
  return { ...projected, quiet: true };
}
