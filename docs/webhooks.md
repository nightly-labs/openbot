# Webhooks

A webhook routine starts when an external service sends a signed request to the routine's URL. An
agent routine and a channel routine both support webhooks. A host administrator configures them in the routine
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

The URL also changes when you sign in to a different OpenBot account on the host. The secret stays
the same. Copy the new URL into the sending service.

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

In the routine editor, select **Filter events** to add an event type or a filter. With no event type
and no filter, each signed request starts the routine.

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
| `503` | The host is offline, busy, or did not answer in 2.5 seconds. The relay does not know the route, the host cannot read the secret, or the agent or channel cannot take a run now. | Yes, later |

A `202` response does not mean that the run is complete. Look at the routine history for the run
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

## History

The routine history shows each request that the host ignored, with the reason: the event type or
a filter did not match, or the routine was not active.

## Data retention

- Receipts: 7 days. A receipt has the delivery ID, the event type, the result, and the run ID. It
  does not have the request body.
- Deleting a routine deletes its receipts.

## Security

- Only host administrators can manage webhook routines.
- The host verifies the signature before it decodes the body. The relay does not have the secret.
- Secrets are encrypted with the operating system's secret storage. They are not in logs, errors,
  or activity.
