# Status webhooks

The status page at `status.openbot.run` can send its incidents and service changes to the tools of
the OpenBot team, such as a Slack channel or an on-call service. These webhooks are for the team
only. The public way to follow the page is its feed, `https://status.openbot.run/feed.xml`.

The `notify` job of the `status-page` workflow sends them. It runs after each run that publishes the
page, so a new event goes out about 5 minutes after it occurs, or a short time after a person edits
a `status` issue. GitHub can start scheduled runs late.

## Add a subscription

The subscriptions are in the `STATUS_WEBHOOKS` repository secret, as one JSON list:

```json
[
  { "id": "oncall", "url": "https://example.com/hooks/status", "secret": "<at least 32 characters>" },
  { "id": "team-slack", "url": "https://hooks.slack.com/services/…", "format": "slack" },
  { "id": "ops-discord", "url": "https://discord.com/api/webhooks/…", "format": "discord", "events": ["incident.created", "service.changed"] }
]
```

| Field | Necessary | Meaning |
| --- | --- | --- |
| `id` | Yes | A name of 1 to 40 lowercase letters, digits and `-`. The log and the job summary show it in place of the URL. Do not change it: the waiting deliveries and the delivery IDs use it. |
| `url` | Yes | The address. It must use `https`. |
| `secret` | For `json` | The signing key, at least 32 characters. Make one with `openssl rand -hex 32`. |
| `format` | No | `json` (the default), `slack` (an incoming webhook) or `discord` (a channel webhook). |
| `events` | No | The event types to send. Without it, all incident and maintenance events. |
| `paused` | No | `true` stops the deliveries. The waiting deliveries are removed. |

To change the list, replace the whole secret:
`gh secret set STATUS_WEBHOOKS -R nightly-labs/openbot < webhooks.json`. Then delete `webhooks.json`.
The secret is not in the log: the job masks each URL and secret before it does anything else. An
error in the list names only the entry number, the field or the `id`. A list that is not valid stops
the job, and the job sends nothing.

To check a subscription, run the `status-page` workflow from the Actions tab, with the input **Also send a test
event to each active status webhook**. Each subscription that is not paused gets one `test` event.

## Events

| Type | When |
| --- | --- |
| `incident.created` | A new incident issue. |
| `incident.updated` | A new comment on an incident. A comment with the stage `Resolved` is not sent alone: `incident.resolved` carries it. |
| `incident.resolved` | An incident issue closes. It carries the final update. |
| `incident.removed` | An open incident leaves the page, for example a false alarm closed as not planned, or an issue without the `status` label. |
| `maintenance.scheduled` | A new maintenance issue. |
| `maintenance.started` | The maintenance window starts. |
| `maintenance.updated` | A new comment on a maintenance issue. |
| `maintenance.completed` | The maintenance window ends, or the issue closes before the end. |
| `maintenance.cancelled` | A maintenance that has not ended leaves the page, for example an issue closed before the start. |
| `service.changed` | The result of a service check changes, for example from `ok` to `down`. Only on request. |
| `test` | A test from the workflow input. Always sent. |

`service.changed` is not in the defaults. A check can fail for one run because of a network error,
and 2 failed runs open an automatic incident, which sends `incident.created`.

`incident.removed` and `maintenance.cancelled` come one run later than the change, because the
schedule runs and the issue runs can publish an older page after a newer one. An incident issue that
opens again sends no event. Its next comment sends `incident.updated`, and the next close sends
`incident.resolved` again.

The first run on a repository without the `status-notify` branch sends nothing. It marks the events
that are on the page as sent.

## Payload

A `json` subscription gets this body, version 1. New fields can come in a later version 1 body.
The meaning of a field does not change.

```json
{
  "version": 1,
  "id": "incident.updated:201:2026-10-16T11:00:00Z:identified",
  "type": "incident.updated",
  "createdAt": "2026-10-16T11:05:12.000Z",
  "page": "https://status.openbot.run",
  "incident": {
    "id": 201,
    "url": "https://github.com/nightly-labs/openbot/issues/201",
    "title": "Invitation links fail",
    "kind": "incident",
    "impact": "partial",
    "services": [{ "id": "accounts", "name": "Accounts and sign-in" }],
    "startedAt": "2026-10-16T10:30:00Z",
    "resolvedAt": null,
    "update": { "at": "2026-10-16T11:00:00Z", "stage": "identified", "body": "A bad cache rule." }
  },
  "service": null
}
```

- `id` identifies the event. It is the same for each subscription.
- `createdAt` is the time of the run that found the event.
- `incident` is `null` for `service.changed` and `test`. `incident.update` is the update that the
  event announces, or the newest one.
- `service` is set only for `service.changed`:
  `{ "id", "name", "previous", "current", "checkedAt" }`. A result is `ok`, `degraded`, `down` or
  `unknown`.
- `impact` is `degraded`, `partial`, `major` or `maintenance`. `stage` is `investigating`,
  `identified`, `monitoring`, `update`, `resolved`, `scheduled` or `completed`.

`slack` and `discord` subscriptions get a short message with a link. A Discord message mentions
nobody, even if the incident text contains `@everyone`.

## Headers and signature

| Header | Value |
| --- | --- |
| `x-openbot-event` | The event type. |
| `x-openbot-delivery-id` | 32 hexadecimal characters. The same for each try of one event to one subscription. |
| `x-openbot-timestamp` | The send time, in Unix seconds. |
| `x-openbot-signature` | `sha256=<hex>`, when the subscription has a secret. |

The signature is the HMAC-SHA256, with the secret as key, of `<timestamp>.<delivery>.<body>`. This
is the same format as [OpenBot webhook routines](webhooks.md#headers-and-signature). A receiver must:

1. Calculate the signature from the raw body, and compare it in constant time.
2. Refuse a timestamp that is not within 5 minutes of its clock.
3. Keep the delivery IDs of the last 2 days, and answer `200` to a repeat without doing the work
   again.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(headers: Headers, body: string, secret: string) {
  const timestamp = headers.get("x-openbot-timestamp") ?? "";
  const delivery = headers.get("x-openbot-delivery-id") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${delivery}.${body}`).digest("hex")}`;
  const actual = headers.get("x-openbot-signature") ?? "";
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  return fresh && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
```

## Retries

Only a `2xx` answer within 10 seconds is a success. A redirect is a failure. After a failure, the
next tries come in later runs, after 5, 10, 20, 40, 80, 160 and 320 minutes: 8 tries in about 11
hours. Then the delivery is removed, and the job summary shows it with a warning. A failed try stops
the other deliveries of that subscription until the next run. One subscription gets at most 25 tries
in one run.

The events can arrive out of order, and a receiver can get an event again. Use the delivery ID and
the `incident.update.at` time, not the arrival order.

Only one webhook job runs at a time, and GitHub keeps only the newest job that waits. A service
change that the newest job does not see again, and a test event, can be lost. If a test event does
not arrive, run the workflow again.

## State

The job keeps its state in `notify.json` on the `status-notify` branch, as one commit that each run
replaces. It holds the subscription IDs, the event IDs that it found, and the waiting deliveries with
their bodies. It never holds a URL or a secret. The repository is public, so anyone can read the
subscription IDs, the retry times and the last error of each waiting delivery, such as `HTTP 500`.
Use IDs that show nothing private. If you delete the branch, the next run starts again:
it marks all events as sent, sends nothing, and loses the waiting deliveries.
