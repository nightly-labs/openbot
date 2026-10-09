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
| Route ID → host and owner account, link time, revoke time | Account service D1 | `webhook_routes` |
| Route ID → ingress socket | Signal memory | `SignalService` |

Schema v30 (`src/backend/openbot-database-schema.ts`) only adds these tables. Existing routines and
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
sync and does not fail the save. After a failed call, the sync runs again after 30 seconds. The delay
doubles up to 15 minutes until a sync succeeds. The save releases its write lock before the sync, so a slow network
does not block other saves. At start and when the signed-in account changes, the host registers all
routes again. A token refresh does not start a sync.

`HostEventsRuntime` runs one sync at a time. Requests that arrive during a sync become one more sync.
A routine change starts a sync. An agent or channel event starts one only when the owner is gone,
because turns and messages also send these events. When the account service answers
`webhook_route_conflict` (the ID is revoked or belongs to another host or account), the backend gives
the routine a new route ID, keeps the secret, and registers the new ID. The URL changes.

A routine delete, a change to `schedule`, and an agent or channel delete all call
`revokeRoutineWebhooks`. It writes the route ID to `projection_webhook_route_revocations` and removes
the trigger row in the same transaction. `syncRoutes` drains the queue: the account service marks
the route revoked and sends `webhook-route-revoked` to Signal. A failed revocation stays in the queue
for the next sync. The account service never deletes a
route row and never frees its ID, also not after a host or account delete: senders can still post to
the old public URL, so the ID must never belong to another host. A routine or owner delete also removes its
receipts. A change to `schedule` keeps them.

The ingress socket presents a signed route ticket with the current routes, signed with the remote
ticket key and the webhook route audience
(`WEBHOOK_ROUTE_TTL_SECONDS`, 5 minutes). After a route change, the host opens a new socket to get a
new ticket. Signal keeps revocations in memory. For 5 minutes after Signal starts, it confirms each
ticket route with the account service. The host keeps the webhook ingress open while it has at least
one route. When Slack or Discord share the socket, a failed webhook ticket does not stop them: the
socket connects without webhook routes. After it is online, the host opens it again with a backoff
of 2 seconds that doubles up to 5 minutes, until Signal confirms the webhook route.

## Inbound request

Signal (`remote/api/src/app.ts`) accepts `POST /v1/webhooks/:routeId`. It checks, in this order:
route ID syntax (404), declared body size (413), `Content-Type: application/json` (415), header
syntax (401), a socket that holds the route (503), rate limit by route and client address (429), and
body size (413). So an unknown route uses no rate-limit entry and Signal does not read its body.
Signal then sends the exact bytes and the three header values to the host socket and waits for the
status. It also returns 503 when the host has too many pending requests or does not answer in 2.5
seconds. Slack and webhook deliveries share one pending budget for each host (16 requests, 128 KiB),
which stays below the socket backpressure limit. Signal has no queue and does not store or log the
body. The header patterns are in `packages/contracts/src/signal-protocol/webhook-route.ts`.

The host (`HostEventsService.receive`) returns:

| Status | Cause |
| --- | --- |
| 413 | Body larger than `WEBHOOK_DELIVERY_BODY_BYTES_LIMIT` (64 KiB), or the run instruction with the event is longer than `INPUT_LIMITS.messageText`; no receipt |
| 404 | Unknown route, or the routine is no longer a webhook routine |
| 401 | Bad timestamp, delivery ID, or signature (`verifyWebhookSignature`) |
| 400 | Body is not UTF-8 JSON `{ type, occurredAt?, data? }` |
| 202 | Run started, or ignored: `event-type`, `filter`, or `inactive` |
| 200 | Duplicate delivery ID for this routine |
| 503 | The host cannot decrypt the secret, the agent is held or being deleted, the channel is archived or held, or the handler failed |

Verification comes before JSON decoding. The signature is
`sha256=HMAC-SHA256(secret, "<timestamp>.<deliveryId>.<body>")`, compared in constant time. The
timestamp must be within 5 minutes. The delivery ID matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`.

The receipt and the run commit in one transaction. The unique key `(owner_kind, routine_id,
delivery_id)` makes a repeated delivery a no-op. Ignored requests also write a receipt, so their IDs
are also deduplicated. Receipts older than 7 days do not count as duplicates, and they are pruned when
a new receipt is written. The
event is kept only in the run instruction, between `--- external event input ---` markers, so a
restart that resumes the run still has it. Runs use the existing agent and channel queues, provider
limits, and approval controls. While a restart waits for idle agents (`holdRoutines`), the host
answers 503 and writes no receipt, so the sender retries after the restart.

## Management surfaces

- Local desktop: the `events` IPC group (`packages/contracts/src/ipc-endpoints.ts`).
- Remote hosts: the `events-v1` Team API capability, `EVENTS_ROUTES` in
  `packages/contracts/src/team-protocol/events-v1.ts`. All routes need a host administrator. The
  routes are status, routine list, save, delete, and test, `rotateSecret`, and activity. Activity is
  the receipts of one routine. A failure with catalog text returns 400. Other failures return 500
  with `error.team.requestFailed`, and the dispatcher logs them.
- Released schedule-only routine views do not show webhook routines. Their delete and test routes
  answer "routine gone" for a webhook routine, because they have no administrator check. Only a
  schedule routine writes a conversation event.
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
- Only the events surface, which needs a host administrator, can change, test, or delete a webhook
  routine.

## Rollout

Deploy the account service and Signal before the desktop release. Keep the Slack and Discord ingress
contracts unchanged. The migration must preserve released schemas, update the latest schema, and
pass schema parity and rollback checks.
