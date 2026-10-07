# Webhooks

A webhook source lets an external service start an OpenBot routine. An outbound webhook sends a
routine's status to an HTTPS endpoint. A host administrator configures them in the routine editor. Choose **Webhook** under
**When to run**, then create or select a source. Open **Connection settings** to change its name,
secret, or enabled state. **Webhooks and activity** contains outgoing notifications and recent activity
for the saved routine. The host must be online to receive new requests.

## Receive an event

1. Add a source. Enter a name and a random signing secret with at least 32 characters. Keep the
   secret in the sending service's secret store. OpenBot does not display it again.
2. Copy the public URL after the route is ready.
3. Create or edit a routine. Select **Event**, the source, and an event type. Add filters if needed.
4. Send a signed JSON request to the source URL.

The body has this shape:

```json
{
  "type": "deployment.completed",
  "occurredAt": "2026-10-07T10:00:00.000Z",
  "data": { "environment": "production", "revision": "abc123" }
}
```

`occurredAt` is optional. When it is absent, OpenBot uses the receipt time. `data` is a JSON value.
The event type must match the routine trigger exactly. A filter such as `/environment` equal to
`production` reads `data.environment`. All filters must match. JSON Pointer uses `~1` for `/` and
`~0` for `~`. An empty pointer selects the complete `data` value.

Sign the exact UTF-8 body bytes. Do not parse and serialize the body again after signing it. Each
request has these headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OpenBot-Timestamp` | Current Unix time in seconds |
| `X-OpenBot-Delivery-Id` | A unique ID for this source event |
| `X-OpenBot-Signature` | `sha256=` followed by the lowercase hexadecimal HMAC-SHA256 |

The signed bytes are `timestamp + "." + deliveryId + "." + body`. Timestamps must be within five
minutes of the host clock. Use a new timestamp and signature on a retry, but keep the delivery ID
and body unchanged. Delivery IDs use ASCII letters, numbers, dots, underscores, colons, and hyphens.
The request body is limited to 64 KiB.

Example with Node.js:

```js
import { createHmac, randomUUID } from "node:crypto";

const body = JSON.stringify({ type: "deployment.completed", data: { environment: "production" } });
const timestamp = String(Math.floor(Date.now() / 1000));
const deliveryId = randomUUID(); // Save this ID and the body if the request must be retried.
const signature = createHmac("sha256", process.env.OPENBOT_WEBHOOK_SECRET)
  .update(`${timestamp}.${deliveryId}.`)
  .update(body)
  .digest("hex");
const response = await fetch(process.env.OPENBOT_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-OpenBot-Timestamp": timestamp,
    "X-OpenBot-Delivery-Id": deliveryId,
    "X-OpenBot-Signature": `sha256=${signature}`,
  },
  body,
});
if (!response.ok) throw new Error(`Webhook was not accepted: ${response.status}`);
```

A success response means that the host saved the event. Check **Activity** for the routine result.
A repeated delivery ID does not start another run. A network failure or retryable HTTP error does
not prove that the event was rejected: retry with the same ID. The relay has no offline queue.

To rotate a secret, enter its replacement in the source settings and update the sender. Old
signatures stop working when the replacement is saved. Disable a source to stop accepting events.
Existing accepted work and history remain local.

## Send routine status

Add an outbound webhook and choose its destination, method, and routine event types:

- `routine.run.started`
- `routine.run.succeeded`
- `routine.run.failed`
- `routine.run.needs_attention`

Leave the routine selection empty to include all routines. Notifications contain routine and run
IDs, routine names, status, and times. They exclude instructions, messages, results, and raw errors.
Custom header values and signing secrets are write-only. Use headers for credentials, not URL
query parameters.

The default JSON payload has `eventId`, `eventType`, `runId`, `routineId`, `routineName`,
`status`, and `occurredAt`. The request uses the same signature headers and HMAC contract as an
inbound request. Each retry has a fresh timestamp and signature, with the same event ID and body.

An optional JSON template can use these fields: `{{event.id}}`, `{{event.type}}`,
`{{event.runId}}`, `{{event.routineId}}`, `{{event.routineName}}`, `{{event.status}}`, and
`{{event.occurredAt}}`. A field used as a complete JSON string value retains its value type.
A field inside a longer string becomes text. Templates cannot execute code. For example:

```json
{ "run": "{{event.runId}}", "message": "{{event.routineName}}: {{event.status}}" }
```

The destination must use HTTPS and resolve to public addresses. OpenBot refuses private and
loopback addresses and does not follow redirects. Return a 2xx response after saving a delivery.
Verify the HMAC against the exact received bytes with a constant-time comparison. Deduplicate the
delivery ID before applying effects. A lost response can cause a repeated delivery.

OpenBot retries network failures and HTTP 408, 429, and 5xx responses. There are at most six
automatic attempts. Retry delays are 10 seconds, 1 minute, 5 minutes, 30 minutes, and 2 hours.
`Retry-After` can delay a retry within the 24-hour delivery window. Other HTTP responses stop
automatic retries. Activity shows failed deliveries and permits a manual retry. A manual retry
starts a new 24-hour delivery window with the same event ID and payload.

Disabling a destination stops new attempts. Enabling it resumes pending deliveries within their
delivery window. A host restart retains pending deliveries.

## Future sources

A source adapter supplies a verified event envelope. Routine matching and execution do not depend
on the source's HTTP format. A future GitHub adapter can add GitHub signature checks, event types,
and repository filters without replacing the routine engine. This release does not include a
GitHub event adapter.
