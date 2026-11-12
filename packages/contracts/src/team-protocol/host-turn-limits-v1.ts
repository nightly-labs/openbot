// Frozen optional host-turn-limits-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server reads and sets two limits of its host.
// - `turnLimit` (1 to 128, or "unlimited"): the most agent turns that run at the same time on the
//   host, over all its agents and their tasks. "unlimited" sets no limit, also on a server whose
//   memory sets one. Null is automatic, which the snapshot gives as `automaticTurnLimit`: on a
//   server, a number that its memory sets; null when the host has no such limit, as on a desktop
//   computer. A set value can be above the automatic one. The memory guard of a server still holds
//   new turns while its memory is low.
// - `agentTaskLimit` (1 to 64): the task limit of each agent that has no limit of its own. Null is the
//   built-in default, which the snapshot gives as `defaultAgentTaskLimit`.
// A lower limit stops no running turn; the next turn waits. An update sets both fields. A member
// cannot use either route; `requireAdmin` on the host is the only gate. Widening any of it needs a
// second capability string.
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const HOST_TURN_LIMITS_CAPABILITY = "host-turn-limits-v1";

export const HOST_TURN_LIMITS_ROUTES = {
  settings: "/v1/admin/host/turn-limits",
  update: "/v1/admin/host/turn-limits/update",
} as const;

const between =
  (maximum: number): AdminDecoder =>
  (input) => {
    if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > maximum)
      throw new Error("Invalid turn limit.");
    return input;
  };
const turnLimit = nullable((input) => (input === "unlimited" ? input : between(128)(input)));
const agentTaskLimit = nullable(between(64));
/** The automatic value can follow a larger memory than any set value permits, so it has a wider bound. */
const automaticTurnLimit = nullable(between(1_024));
const snapshot = fields({ turnLimit, automaticTurnLimit, agentTaskLimit, defaultAgentTaskLimit: between(64) });

export const HOST_TURN_LIMITS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_TURN_LIMITS_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_TURN_LIMITS_ROUTES.update, adminRoute(fields({ turnLimit, agentTaskLimit }), snapshot)],
]);
