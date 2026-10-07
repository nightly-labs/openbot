# Events and webhooks

An event source describes where an event comes from. A routine has one schedule or one event
trigger. An event trigger selects a source, an exact event type, and optional JSON Pointer filters.
Each filter compares one scalar value. All filters must match. Filters and payload templates do
not execute code.

The flow is source → event → routine → run → notification. Source adapters authenticate input and
produce a versioned event envelope. They do not start an agent. This keeps future sources, such as
GitHub, separate from routine execution.

## Ownership

The host's SQLite database owns sources, accepted events, dispatch records, subscriptions, and
outbound delivery records. Secrets are encrypted with the host's existing secret cipher. Public
management responses do not contain secrets or secret header values.

Signal forwards inbound requests over the host ingress connection. Account routing records contain
only route and authorization metadata. Neither service stores or logs event bodies. An HTTP success
means that the host committed the event; it does not mean that the routine finished.

An offline host cannot accept events. The relay returns a retryable error and the sender must retry.
There is no cloud queue. A sender that does not retry can lose events while the host is offline.

## Routine execution

Accepted events have a source-scoped delivery ID. Repeated delivery IDs refer to the same receipt.
Dispatch records link a receipt to its routine run. Receipt storage and dispatch creation must be
atomic. A restart resumes dispatch from these records, not from an in-memory event emitter.

Event data is external input. It is separate from the routine's saved instructions. Runs use the
existing agent and channel queues, provider usage limits, and approval controls.

Scheduled routines keep their released Team API representation. Event routines use an additive
capability and separate frozen codecs. Clients without that capability continue to manage scheduled
routines; they cannot edit an event routine through a schedule-only route.

## Outbound notifications

Outbound subscriptions select routine run events. They contain IDs, names, status, and times. They
do not contain prompts, conversation content, result text, or raw errors. The host records pending
notifications in the transaction that commits the run change. Network delivery starts after commit.

Each destination uses HTTPS and POST, PUT, or PATCH. Payload templates substitute documented event
fields into JSON values. Delivery IDs and payload bytes stay the same across retries. Receivers must
deduplicate deliveries because a receiver can accept a request before its response is lost.

The retry policy is one initial attempt, then delays of 10 seconds, 1 minute, 5 minutes, 30 minutes,
and 2 hours. Network failures and HTTP 408, 429, and 5xx responses are retryable. Retry-After is
bounded by a 24-hour delivery window. HTTP 2xx means success. Other responses are terminal failures.
Redirects are not followed. A disabled destination stops new attempts. Enabling it resumes pending
deliveries that remain within the delivery window. An administrator can retry a failed delivery.

## Threat model

The untrusted inputs are public request bytes, sender clocks and IDs, destination DNS answers,
and receiver responses. The host secret is the inbound authority. Host administrator access is the
configuration authority. A valid event is still external data; its contents cannot grant tools or
bypass approvals. The relay is a transport and cannot authorize a routine run without a valid host
signature.

Threats include replay, duplicate work after a lost response, cross-host route use, secret exposure,
resource exhaustion, prompt injection, and requests to private services. The controls are:

- Only host administrators manage sources, subscriptions, and event routines.
- Inbound signatures bind the timestamp, delivery ID, and exact body bytes. Verification precedes
  JSON decoding and dispatch. Old timestamps and invalid signatures are rejected.
- Secret inputs are write-only. Rotation replaces the stored secret. Secret values are never part
  of an activity entry, public error, or log message.
- Body limits, rate limits, and bounded pending requests protect the relay and host.
- Outbound destinations must resolve to public addresses. Checks include IPv4, IPv6, and mapped
  addresses. The request uses the checked address to prevent DNS rebinding.
- Deleting or disabling a source prevents new receipts. Deleting a destination prevents further
  delivery. Existing run records remain available for diagnosis.

## Rollout

Deploy additive account and Signal support before desktop support. A public source is ready only
when its route is registered and its host ingress connection supports webhook delivery. Keep the
existing Slack and Discord ingress contracts unchanged.

The migration must preserve released schemas, update the latest schema for new databases, and pass
schema parity and rollback checks. Focused integration checks must cover duplicate receipt, lost
acknowledgement, restart, offline host, retries, disable/enable, rotation, and deletion.

## Routine editor

Schedule and Webhook are trigger choices in the existing routine editor for teammates and groups.
Source setup is inline. Filters and connection settings expand when needed. Outbound notifications
and event activity are scoped to the selected routine. There is no Events section in server settings.
Desktop and web share the source and notification controls in `packages/ui`; mobile uses native controls.
