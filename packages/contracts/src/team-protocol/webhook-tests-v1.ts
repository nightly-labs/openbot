// Frozen optional webhook-tests-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server asks the host to send one test event to a webhook routine. The host makes an event that
// matches the routine's event type and filters, signs it with the routine secret, and receives it as
// it receives a relayed request: the receipt shows in the routine activity, and a match starts a run.
// The answer names the event type it sent, whether a run started, why not, and the run.
// The secret never leaves the host. Widening any of it needs a second capability string.
import { adminRoute, fields, identifier, nullable, type OptionalRouteCodec, oneOf, string } from "./admin-wire";
import { routineOwner } from "./events-v1";

export const WEBHOOK_TESTS_CAPABILITY = "webhook-tests-v1";

export const WEBHOOK_TESTS_ROUTES = {
  send: "/v1/admin/webhook-tests/send",
} as const;

const result = fields({
  eventType: string(256),
  status: oneOf("started", "ignored"),
  reason: nullable(oneOf("event-type", "filter", "inactive")),
  runId: nullable(identifier),
});

export const WEBHOOK_TESTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WEBHOOK_TESTS_ROUTES.send, adminRoute(fields({ id: identifier, owner: routineOwner }), result)],
]);
