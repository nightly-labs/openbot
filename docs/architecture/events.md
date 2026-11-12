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
| Workflow trigger route ID, encrypted secret, URL | Host SQLite | `workflow_trigger_webhooks` (schema v46) |
| Receipts (no body) | Host SQLite | `projection_webhook_receipts`, `workflow_webhook_receipts` |
| GitHub deliveries (no body), runs per item, changes made | Host SQLite | `workflow_github_deliveries`, `workflow_github_runs`, `workflow_github_actions` (schema v49) |
| GitHub repository → ingress socket | Signal memory | `SignalService` |
| Routes to revoke on the relay | Host SQLite | `projection_webhook_route_revocations` |
| Route ID → host and owner account, link time, revoke time | Account service D1 | `webhook_routes` |
| Route ID → ingress socket | Signal memory | `SignalService` |

Schema v30 (`src/backend/openbot-database-schema.ts`) only adds these tables. Existing routines and
runs do not change.

- `RoutineStore` (`src/backend/routine-store.ts`) writes the trigger row with the routine, in the
  same transaction. A changed trigger kind keeps the routine ID and its runs.
- `WebhookRouteStore` (`src/backend/webhook-route-store.ts`) reads routes, rotates secrets, keeps
  receipts, and holds the revocation queue. A route's owner is a `WebhookRouteOwner`: an agent or
  channel routine (`EventRoutineOwner`), or `{ kind: "workflow" }` for a webhook trigger of a
  [workflow](agents.md#workflows). The workflow arm stays in the backend; the events API and
  `events-v1` encoders name routine owners only.
- `RoutineRecords` (`src/backend/routine-records.ts`) is the one backend object that main uses. It
  selects the agent or channel scheduler by owner and holds the webhook route store.
- `webhook-trigger.ts` has trigger validation, filter matching, the run instruction, and template
  filling.
- Main owns the secret cipher, signature checks, and the relay: `HostEventsService`
  (`src/main/host-events-service.ts`), `WebhookRelay`, `HostEventsRuntime`, and `webhook-security.ts`.

## Route lifecycle

The backend makes the route ID (a UUID) when a routine first gets a webhook trigger. Main makes the
secret, `whsec_` and 32 random bytes in base64 (the Standard Webhooks format), and encrypts it with the host secret cipher
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
seconds. Slack, webhook and GitHub deliveries share one pending budget for each host (16 requests,
768 KiB of base64), which stays below the 1 MiB socket backpressure limit. Signal has no queue and does not store or log the
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
| 503 | The host has no signed-in account or cannot decrypt the secret, the agent is held or being deleted, the channel is archived or held, or the handler failed |

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

### Analytics

`HostEventsService` gives each request that it processed, and each test event, to its `onDelivery`
option as a `WebhookDeliveryReport`: owner kind, format, result, ignored reason, status, body size,
handle time and, for a request with a valid signature, the delivery age. The application services
send it as `system_webhook_delivery`, at most 60 each minute (`HostAnalytics.handleWebhookDelivery`).
The report has no route ID, delivery ID, secret, event type or body. A request that Signal refuses
before the host does not reach it: Signal counts its answers by status and its waits for the host in
`/metrics` (`openbot_remote_webhook_*`), and the capacity reporter sends the change of each 5 minutes
in `signal_capacity`. `bun run test:webhook-analytics` checks the host side. See
[ANALYTICS.md](../../ANALYTICS.md).

### Workflow webhook triggers

A workflow webhook trigger has no route until its first secret: `rotateWorkflowSecret` makes the
route ID and the secret together. Workflow routes count toward `WEBHOOK_ROUTES_LIMIT`. A
`workflows-changed` event starts `syncRoutes`. A save that removes the trigger node, and a workflow
delete, write the route ID to `projection_webhook_route_revocations` in the same transaction.
`HostEventsService` checks the signature, then gives a request for a `workflow` owner to
`Workflows.receiveWebhook`. The receipt is in `workflow_webhook_receipts` for 7 days, without the
body. A body of more than 64,000 characters gets 413 and no receipt. A workflow with an open run
answers 202 `ignored` with the reason `busy`, as a schedule skips an occurrence. The body, marked as
data, is the trigger's output. Workflow triggers have no test event.

### Workflow GitHub triggers

A GitHub trigger has no secret or route of its own. The OpenBot GitHub App sends every event to
Signal (`/v1/github/events`, see `remote/README.md`). `GitHubRelay` (`src/main/github-relay.ts`)
asks the account service for a GitHub route ticket that names the repositories of the saved GitHub
triggers, and the `ingress` socket sends it to Signal. The account service checks the repositories
with the host's GitHub sign-in; D1 keeps none of them. Signal gives each event to every host that
watches its repository, and the host answers with `github-delivery-result`.

`Workflows.receiveGitHub` records each delivery in `workflow_github_deliveries`, without the body,
the newest 50 per trigger (`WORKFLOW_GITHUB_DELIVERY_LIMIT`). A delivery ID that is there already
records nothing. A delivery is `started`, `waiting` (its item has an open run), or `skipped` with a
reason:

- `filter`: the event or a filter of the trigger does not match.
- `self`: the event is the echo of a change that a run of this workflow made, by the GitHub object
  ID in `workflow_github_actions`.
- `chain`: OpenBot's bot caused 3 runs on the item in 10 minutes.
- `refused`: the run could not start.
- `offline`: the host lost its GitHub route. Signal does not keep events for a host that is offline,
  and GitHub does not send them again, so the history shows the gap. Gaps closer than 2 minutes are
  one gap.

`workflow_github_runs` links a run to its item. When a run ends, the oldest waiting delivery of its
item starts. The event, marked as data, is the trigger's output.

### Workflow Discord triggers

A Discord trigger uses the Discord connection of the host's messaging. It has no route, secret or
table of its own. Signal passes on the messages that mention OpenBot or OpenBot's own role in the
server (the role match needs a Signal deploy). A trigger limited to a channel does not start for a
mention in a thread of that channel: the Signal message names the thread, not its parent.
`MessagingService` gives each mention in a server channel (not a direct message, not a
reply in an existing conversation) to `Workflows.receiveDiscord` before it goes to an agent. The
trigger matches the connection, the channel (empty: any), the author's roles (empty: any) and a
text filter (`discord-matching.ts`). A matched mention starts one run for each trigger, with source
`discord` (schema v50) and the idempotency key `discord:<node>:<message>`, and does not start an
agent conversation. A workflow with an open run skips the mention; when all matched triggers skip
it, OpenBot adds the failed reaction to the message.

The run payload is the mention, marked as data. A Discord output reads the channel and message ID
from it: a reply and a reaction act on that message; a post goes to a chosen channel. Each post or
reaction is a row of `workflow_output_deliveries`. Only the local computer lists Discord servers,
and only an owner or admin changes a Discord node (`route-workflows.ts`).

### Workflow Telegram triggers

A Telegram trigger uses the Telegram connections of the host's messaging. It has no route, secret or
table of its own, and Signal does not change: it already passes on each update of a linked chat. One
connection is one chat. `MessagingService` gives each new conversation in a group (a message that
mentions the bot or replies to it; not a direct chat, not a message of an existing conversation) to
`Workflows.receiveTelegram` before it goes to the Telegram Orchestrator. The trigger matches the
connection (empty: any linked chat) and a text filter (`telegram-matching.ts`). A matched message
starts one run for each trigger, with source `telegram` (schema v52) and the idempotency key
`telegram:<node>:<connection>:<message>`, because a Telegram message ID is unique only in its chat. It
does not start an agent conversation. A workflow with an open run
skips the message; when all matched triggers skip it, OpenBot adds the failed reaction to it.

The run payload is the message, marked as data, with its chat, thread key and message ID. A Telegram
output reads them from it only in a run that a Telegram message started: a reply and a reaction act
on that message; a post goes to the chosen chat, or to the trigger's chat. A reaction is one emoji of
`WORKFLOW_TELEGRAM_EMOJI`, which Telegram allows a bot to set (`setMessageReaction`). Each post or
reaction is a row of `workflow_output_deliveries`. Only the local computer lists Telegram chats, and
only an owner or admin changes a Telegram node (`route-workflows.ts`).

### Workflow Slack triggers

A Slack trigger uses the Slack connection of the host's messaging. It has no route, secret or table
of its own. The only event is `app_mention` in a channel. `MessagingService` gives each mention in a
channel (not a direct message, not a reply in an existing conversation) to `Workflows.receiveSlack`
before it goes to an agent. The trigger matches the connection, the channel (empty: any) and a text
filter (`slack-matching.ts`). Slack has no people filter: the host has no catalog of Slack people. A
matched mention starts one run for each trigger, with source `slack` (schema v53) and the idempotency
key `slack:<node>:<channel>:<message timestamp>`, because a Slack timestamp is unique only in its
channel. A workflow with an open run skips the mention; when all matched triggers skip it, OpenBot
adds the failed reaction to the message.

The run payload is the mention, marked as data, with the file names, types and sizes but not their
addresses, because these need the bot token. A Slack output reads the channel, message and thread
from it: a reply goes to the mention's thread, and a reaction acts on the mention; a post goes to a
chosen channel. The reaction emoji map to Slack names (`WORKFLOW_SLACK_EMOJI`). Each post or reaction
is a row of `workflow_output_deliveries`. Only the local computer lists Slack workspaces, and only an
owner or admin changes a Slack node (`route-workflows.ts`).

## Management surfaces

- Local desktop: the `events` IPC group (`packages/contracts/src/ipc-endpoints.ts`).
- Remote hosts: the `events-v1` Team API capability, `EVENTS_ROUTES` in
  `packages/contracts/src/team-protocol/events-v1.ts`. All routes need a host administrator. The
  routes are status, routine list, save, delete, and test, `rotateSecret`, and activity. Activity is
  the receipts of one routine. A failure with catalog text returns 400. Other failures return 500
  with `error.team.requestFailed`, and the dispatcher logs them.
- Remote hosts with `routine-recovery-v1` (`ROUTINE_RECOVERY_ROUTES`) also answer a routine list and
  save that carry `missedPolicy`, and a run list that includes the records of missed occurrences. A
  client uses these routes in place of the `events-v1` list and save. For a host without the
  capability, the editor hides the missed-run choice and the host keeps its saved value.
- Remote hosts with `webhook-tests-v1` (`WEBHOOK_TESTS_ROUTES`) also answer a test event. The host
  makes an event that matches the trigger, signs it with the decrypted secret, and gives it to the
  same verification and receipt path as a relayed request (`HostEventsService.sendTestEvent`). The
  answer names the event type, the receipt status and reason, and the run. The secret stays on the
  host. For a host without the capability, the editor leaves out the test step.
- Remote hosts with `webhook-sender-secret-v1` (`WEBHOOK_SENDER_SECRET_ROUTES`) also set a routine's
  secret to a value that the sender made (`HostEventsService.setSecret`). Standard Webhooks senders,
  such as Composio and Svix, make their own secret. The host encrypts the value in the same column as
  a secret that it made, so no migration is necessary. The answer is empty. For a host without the
  capability, the editor and the chat card leave out the button.
- Signal accepts the `X-OpenBot-*` headers, or the Standard Webhooks `webhook-*` or `svix-*`
  headers. It relays a Standard Webhooks request only to an ingress socket whose hello lists
  `standard-webhooks` in `webhookFormats`; for an older host it answers `401`. The host checks the
  `v1` signature (`verifyStandardWebhookSignature`) and uses the complete body as `data`.
- Released schedule-only routine views do not show webhook routines. Their delete and test routes
  answer "routine gone" for a webhook routine, because they have no administrator check. Only a
  schedule routine writes a conversation event.
- Workflow webhook triggers: the `workflows` IPC group and the `workflows-v1` Team API capability
  (`rotate-webhook-secret`). Only an owner or admin sees the URL or makes a new secret.
- Workflow GitHub triggers and outputs: the `workflows` IPC group and the `workflows-github-v1` Team
  API capability (`WORKFLOWS_GITHUB_ROUTES`: catalog, options, history, run with last event). All
  routes need a host administrator. A client without the capability does not offer GitHub.
- Workflow Discord, Telegram and Slack triggers and outputs: no route of their own, and the `workflows-v1`
  graph save refuses a change from a member. The desktop that hosts the workflows offers all three. With
  `workflows-chats-v1`, an owner or admin of a joined server also adds and changes Telegram and Slack
  nodes, with the chats and channels of the `routine-results-v1` options.
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
  routine. An agent can create one with `openbot.create_webhook_routine`, and change its events,
  name, instruction or active state with `openbot.update_webhook_routine`, but only in a turn that a
  person's message started: a routine run can carry a webhook body, which is untrusted. The tool saves through
  `HostEventsService`, so the route limit, the encryption and the relay sync are the same. The tool
  drops the first secret: the result goes to the model provider. The chat card makes a new secret
  through the events surface.

## Rollout

Deploy the account service and Signal before the desktop release. Keep the Slack and Discord ingress
contracts unchanged. The migration must preserve released schemas, update the latest schema, and
pass schema parity and rollback checks.
