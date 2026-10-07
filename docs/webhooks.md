# Webhooks

A webhook routine starts when an external service sends a signed request to the routine's URL. Each
routine can also send notifications about its runs to HTTPS URLs that you choose. An agent routine
and a channel routine both support webhooks. A host administrator configures them in the routine
editor. The host must be online to receive requests.

## Set up a webhook routine

1. Open the routine editor of an agent or a channel.
2. Set **When to run** to **Webhook**.
3. Optional: enter an event type. With no event type, all event types start the routine.
4. Optional: add filters.
5. Save the routine. The host makes the URL and the signing secret.
6. Copy the secret into the secret store of the sending service. OpenBot shows it one time only.
7. Copy the URL. The URL is empty until the account service registers the route. The host must be
   signed in to its OpenBot account.

Each webhook routine has its own URL and secret. A host can have at most 64 webhook routines.

To replace the secret, make a new one in the routine editor and update the sender. The old secret
stops working immediately. A secret has the format `whsec_<43 base64url characters>`.

When you change the routine to **Schedule**, or delete the routine, its URL stops working. If you
change it back to **Webhook**, the routine gets a new URL and a new secret.

## Send a request

Send a `POST` request with `Content-Type: application/json` to the routine URL. The body has this
shape:

```json
{
  "type": "deployment.completed",
  "occurredAt": "2026-10-07T10:00:00.000Z",
  "data": { "environment": "production", "revision": "abc123" }
}
```

| Field | Rule |
| --- | --- |
| `type` | Required. A string of 1 to 256 characters. |
| `occurredAt` | Optional. A date string. If you do not send it, OpenBot uses the receipt time. |
| `data` | Optional. Any JSON value. If you do not send it, the value is `null`. |

The body must be UTF-8 and at most 64 KiB.

### Event type and filters

If the routine has an event type, `type` must be equal to it. A filter has a JSON Pointer into `data`
and a value. The value is a string, number, boolean, or `null`. The value at the pointer must be equal
to the filter value, with the same JSON type. For example, `/environment` with `production` reads
`data.environment`. All filters must match. Use `~1` for `/` and `~0` for `~` in a pointer. An empty
pointer selects all of `data`. A routine can have at most 128 filters.

### Headers and signature

| Header | Value |
| --- | --- |
| `X-OpenBot-Timestamp` | The current Unix time in seconds |
| `X-OpenBot-Delivery-Id` | A unique ID for this event. Use 1 to 256 ASCII letters, digits, `.`, `_`, `:`, or `-`. The first character is a letter or a digit. |
| `X-OpenBot-Signature` | `sha256=` and the lowercase hexadecimal HMAC-SHA256 |

The HMAC key is the routine secret. The signed bytes are `<timestamp>.<deliveryId>.<body>`. Use the
exact body bytes that you send. Do not parse and serialize the body again after you sign it. The
timestamp must be within 5 minutes of the host clock.

Example with Node.js:

```js
import { createHmac, randomUUID } from "node:crypto";

const body = JSON.stringify({ type: "deployment.completed", data: { environment: "production" } });
const deliveryId = randomUUID(); // Keep this ID and the body for a retry.
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", process.env.OPENBOT_WEBHOOK_SECRET)
  .update(`${timestamp}.${deliveryId}.${body}`)
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
if (response.status !== 200 && response.status !== 202) {
  throw new Error(`OpenBot did not accept the event: ${response.status}`);
}
```

### Responses

| Status | Meaning | Retry |
| --- | --- | --- |
| `202` | The host saved the event. The routine started, or the host ignored the event because the event type or a filter did not match, or because the routine is paused. | No |
| `200` | The routine already has this delivery ID. | No |
| `400` | The body is not valid. | No. Correct the body. |
| `401` | A header or the signature is not valid, or the timestamp is not within 5 minutes of the host clock. | No. Correct the secret, the headers, or the clock. |
| `404` | The host does not know the route. | No |
| `413` | The body is larger than 64 KiB. | No |
| `415` | `Content-Type` is not `application/json`. | No |
| `429` | Too many requests to this route from your address. | Yes, later |
| `503` | The host is offline, busy, or did not answer in 2.5 seconds. The relay does not know the route, or the agent or channel cannot take a run now. | Yes, later |

A `202` response does not mean that the run is complete. Look at the routine activity for the run
result. The relay does not keep requests while the host is offline. If you do not retry, the event
is lost.

### Retries and duplicates

The delivery ID is the deduplication key for each routine. To retry, send the same delivery ID and the
same body with a new timestamp and a new signature. A repeated delivery ID gets `200` and does not
start a second run. This also applies to an event that the routine ignored. The host keeps receipts
for 7 days. After that time, the same delivery ID starts a new run.

### What the agent receives

The run instruction is the routine instruction, followed by the event. The event is marked as
external data, not as instructions. It contains the delivery ID, the routine ID, `type`,
`occurredAt`, the receipt time, and `data`. Event data can go to the model provider of the routine,
like all routine input. The data cannot give tools to the agent or skip approvals.

## Send run notifications

A routine can send a notification to one or more destinations when a run changes. Add a destination
in the routine editor. A destination has these settings:

- **URL**: an HTTPS URL of at most 2,048 bytes. The URL cannot contain a user name or a
  password. An IP address in the URL must be a public address.
- **Method**: `POST`, `PUT`, or `PATCH`.
- **Event types**: one or more of `routine.run.started`, `routine.run.succeeded`,
  `routine.run.failed`, and `routine.run.needs_attention`.
- **Payload template**: optional. See [Payload](#payload).
- **Signing secret**: optional. At least 32 characters and at most 1,024 bytes.
- **Secret headers**: optional. At most 32 headers. OpenBot shows only the header names after you
  save them. You cannot set `Content-Type`, `Content-Length`, `Host`, hop-by-hop headers such as
  `Connection`, or headers that start with `X-OpenBot-`.
- **Active**: a destination that is not active gets no new notifications.

Put credentials in secret headers, not in the URL.

### Payload

The default JSON body is:

```json
{
  "eventId": "…",
  "eventType": "routine.run.succeeded",
  "runId": "…",
  "occurredAt": "2026-10-07T10:00:00.000Z",
  "routineId": "…",
  "routineName": "Deploy check",
  "status": "succeeded"
}
```

`status` is `started`, `succeeded`, `failed`, or `needs-attention`. The notification does not contain
instructions, messages, results, or error text.

A payload template is a JSON value with placeholders. Use `{{event.id}}`, `{{event.type}}`,
`{{event.runId}}`, `{{event.routineId}}`, `{{event.routineName}}`, `{{event.status}}`, or
`{{event.occurredAt}}`. You can also write the field names without `event.`. Other placeholders are
not valid. A string that is only one placeholder gets the JSON value of the field. A placeholder in
a longer string becomes text. A template cannot run code. Its maximum size is 64 KiB and its maximum
depth is 16. For example:

```json
{ "run": "{{event.runId}}", "text": "{{event.routineName}}: {{event.status}}" }
```

### Request headers

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OpenBot-Event-Id` | The event ID. It is the same for all destinations. |
| `X-OpenBot-Delivery-Id` | `<eventId>:<destinationId>`. It is the same on each retry. |
| `X-OpenBot-Timestamp` | The Unix time of this attempt, in seconds |
| `X-OpenBot-Signature` | Only when the destination has a secret. `sha256=` and the HMAC-SHA256 of `<timestamp>.<deliveryId>.<body>`. |

Each attempt has a new timestamp and signature. The body and the delivery ID do not change.

### Verify a notification

Verify the signature against the exact bytes that you received. Use a constant-time comparison.
Check that the timestamp is recent. Save the delivery ID before you apply the notification, and
ignore a delivery ID that you already have. A lost response can cause the same delivery again.

Example with Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyOpenBotNotification(secret, headers, rawBody) {
  const timestamp = headers["x-openbot-timestamp"];
  const deliveryId = headers["x-openbot-delivery-id"];
  const signature = headers["x-openbot-signature"] ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.`)
    .update(rawBody)
    .digest("hex");
  const received = signature.replace(/^sha256=/, "");
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
```

Send a `2xx` response after you save the notification.

### Retry policy

| Result | Action |
| --- | --- |
| `2xx` | Success |
| `408`, `429`, `5xx`, network failure, DNS failure | Retry |
| All other statuses, including redirects | Failure. No retry. |
| The response body is larger than 64 KiB | Failure. No retry. |
| The host name resolves to a private address | Failure. No retry. |

There are at most 6 attempts. The delays before attempts 2 to 6 are 10 seconds, 1 minute,
5 minutes, 30 minutes, and 2 hours. A `Retry-After` header can make a delay longer. All attempts must
start within 24 hours of the first attempt. If the next attempt is later than that, the delivery
fails. Each attempt, from DNS lookup to the end of the response, must finish in 30 seconds. OpenBot
does not follow redirects.

The routine activity shows each delivery. You can retry a failed delivery to an active destination.
A manual retry starts a new series of 6 attempts and a new 24-hour window, with the same body and
delivery ID.

Pending deliveries continue after a host restart. When you turn off a destination, queued deliveries
wait. When you turn it on again, they continue if their 24-hour window is still open. When you
delete a destination, its delivery history is also deleted.

## Data retention

- Receipts: 7 days. A receipt has the delivery ID, the event type, the result, and the run ID. It
  does not have the request body.
- Completed and failed deliveries: 30 days.
- Deleting a routine deletes its receipts, destinations, and deliveries.

## Security

- Only host administrators can manage webhook routines and destinations.
- The host verifies the signature before it decodes the body. The relay does not have the secret.
- Secrets and secret header values are encrypted with the operating system's secret storage. They
  are not in logs, errors, or activity.
- The host does not send notifications to private, loopback, or link-local addresses. It checks
  all DNS answers and connects to the address that it checked.
