# Webhook routines

A routine has one trigger: `schedule` or `webhook`. A webhook trigger belongs to its routine. It has
the public URL (`null` until the account service registers the route), an optional exact event type
(`null` accepts all types), and at most 128 JSON Pointer filters. Each filter compares one scalar
value. All filters must match. Filters and payload templates do not run code. Agent routines and
channel routines use the same model. Types: `packages/contracts/src/ipc-events.ts`. There is no
shared, host-level event source. The [user guide](../webhooks.md) has the request format.

The flow is: signed request → route → routine → run.

## Ownership

| Data | Owner | Where |
| --- | --- | --- |
| Trigger, route ID, encrypted secret, URL | Host SQLite | `projection_routine_webhooks`, `projection_channel_routine_webhooks` |
| Receipts (no body) | Host SQLite | `projection_webhook_receipts` |
| Routes to revoke on the relay | Host SQLite | `projection_webhook_route_revocations` |
| Route ID → host and owner account, link time | Account service D1 | `webhook_routes` |
| Route ID → ingress socket | Signal memory | `SignalService` |

Schema v29 (`src/backend/openbot-database-schema.ts`) only adds these tables. Existing routines and
runs do not change.

- `RoutineStore` (`src/backend/routine-store.ts`) writes the trigger row with the routine, in the
  same transaction. A changed trigger kind keeps the routine ID and its runs.
- `WebhookRouteStore` (`src/backend/webhook-route-store.ts`) reads routes, rotates secrets, keeps
  receipts, and holds the revocation queue.
- `RoutineRecords` (`src/backend/routine-records.ts`) is the one backend object that main uses. It
  selects the agent or channel scheduler by owner and holds the webhook route store.
- `webhook-trigger.ts` has trigger validation, filter matching, the run instruction, and template
  filling.
- Main owns the secret cipher, signature checks, and the relay: `HostEventsService`
  (`src/main/host-events-service.ts`), `WebhookRelay`, `HostEventsRuntime`, and `webhook-security.ts`.

## Route lifecycle

The backend makes the route ID (a UUID) when a routine first gets a webhook trigger. Main makes the
secret, `whsec_` and 32 random bytes in base64url, and encrypts it with the host secret cipher
(Electron `safeStorage`). The save result returns the secret one time. `rotateSecret` replaces the
stored ciphertext; the next request uses the new secret, so the old secret stops working at once.
A host has at most `WEBHOOK_ROUTES_LIMIT` (64) routes. Main and the account service both check it.

After a save, `HostEventsService.syncRoutes` registers each route that has no URL. The account
service records the route for the host. `WebhookRelay` builds the URL from the Signal origin and
`WEBHOOK_EVENTS_PATH` (`/v1/webhooks/<routeId>`). A failed call keeps the local state for the next
sync and does not fail the save. At start and after an account change, the host registers all routes
again.

A routine delete, a change to `schedule`, and an agent or channel delete all call
`revokeRoutineWebhooks`. It writes the route ID to `projection_webhook_route_revocations` and removes
the trigger row in the same transaction. `syncRoutes` drains the queue: the account service deletes
the route and sends `webhook-route-revoked` to Signal. A routine or owner delete also removes its
receipts. A change to `schedule` keeps them.

The ingress socket presents a signed route ticket with the current routes
(`WEBHOOK_ROUTE_TTL_SECONDS`, 5 minutes). After a route change, the host opens a new socket to get a
new ticket. Signal keeps revocations in memory. For 5 minutes after Signal starts, it confirms each
ticket route with the account service. The host keeps the webhook ingress open while it has at least
one route.

## Inbound request

Signal (`remote/api/src/app.ts`) accepts `POST /v1/webhooks/:routeId`. It checks, in this order:
route ID syntax (404), declared body size (413), `Content-Type: application/json` (415), rate limit
by route and client address (429), body size (413), and header syntax (401). It then sends the exact
bytes and the three header values to the host socket and waits for the status. It returns 503 when
no socket holds the route, the host has too many pending requests, or the host does not answer in
2.5 seconds. Signal has no queue and does not store or log the body.

The host (`HostEventsService.receive`) returns:

| Status | Cause |
| --- | --- |
| 413 | Body larger than `WEBHOOK_DELIVERY_BODY_BYTES_LIMIT` (64 KiB) |
| 404 | Unknown route, or the routine is no longer a webhook routine |
| 401 | Bad timestamp, delivery ID, or signature (`verifyWebhookSignature`) |
| 400 | Body is not UTF-8 JSON `{ type, occurredAt?, data? }` |
| 202 | Run started, or ignored: `event-type`, `filter`, or `inactive` |
| 200 | Duplicate delivery ID for this routine |
| 503 | The agent is held or being deleted, the channel is archived or held, or the handler failed |

Verification comes before JSON decoding. The signature is
`sha256=HMAC-SHA256(secret, "<timestamp>.<deliveryId>.<body>")`, compared in constant time. The
timestamp must be within 5 minutes. The delivery ID matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`.

The receipt and the run commit in one transaction. The unique key `(owner_kind, routine_id,
delivery_id)` makes a repeated delivery a no-op. Ignored requests also write a receipt, so their IDs
are also deduplicated. Receipts older than 7 days are pruned when a new receipt is written. The
event is kept only in the run instruction, between `--- external event input ---` markers, so a
restart that resumes the run still has it. Runs use the existing agent and channel queues, provider
limits, and approval controls.

## Management surfaces

- Local desktop: the `events` IPC group (`packages/contracts/src/ipc-endpoints.ts`).
- Remote hosts: the `events-v1` Team API capability, `EVENTS_ROUTES` in
  `packages/contracts/src/team-protocol/events-v1.ts`. All routes need a host administrator. The
  routes are status, routine list, save, delete, and test, `rotateSecret`, and activity. Activity is
  the receipts of one routine.
- Released schedule-only routine views do not show webhook routines. Only a schedule routine writes
  a conversation event.
- Desktop and web use the shared routine editor components in
  `packages/ui/src/features/conversation`. Mobile uses native components in
  `apps/mobile/src/features/agents/components`.

## Threat model

The untrusted inputs are public request bytes, sender clocks, and delivery IDs. The routine secret
is the inbound authority. Host administrator access is the configuration authority. A valid event is still external data: it cannot give tools or skip
approvals. The relay cannot start a run without a valid signature.

Controls:

- Signatures bind the timestamp, the delivery ID, and the exact body bytes.
- The secret is made by the host, shown one time, encrypted at rest, and registered for log
  redaction.
- Body limits, Signal rate limits, and bounded pending requests protect the relay and the host.
- A removed trigger revokes its route in the same transaction, and the relay revocation retries
  until it succeeds.

## Rollout

Deploy the account service and Signal before the desktop release. Keep the Slack and Discord ingress
contracts unchanged. The migration must preserve released schemas, update the latest schema, and
pass schema parity and rollback checks.
