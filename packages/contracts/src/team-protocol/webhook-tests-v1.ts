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
