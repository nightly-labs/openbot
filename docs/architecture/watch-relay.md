# Apple Watch direct link

The Apple Watch app reaches the user's hosts without the iPhone app. watchOS allows only HTTPS on the
watch (Apple TN3135), so the watch cannot use the WebRTC link of the phone. It sends HTTPS requests to
Signal, and Signal passes them to the host on the ingress WebSocket that the host keeps open. The
request and the reply are encrypted end to end between the watch and the host. Signal and the
account service see only metadata. The iPhone link (WatchConnectivity) stays as the fallback and for
pairing.

Decided by the developer on 2026-11-25:

- The watch has its own watch session, a child of the phone's account session.
- The watch works when the app lock of the phone is on.
- A watch request wakes a hosted server that sleeps.

## Contracts

| File | Content |
| --- | --- |
| `packages/contracts/src/watch-protocol.ts` | `WatchCommand`, `WatchResult`, `WatchSnapshot`, `WatchDirectCredentials`. The same shapes travel on the iPhone link and on the direct link. |
| `packages/contracts/src/signal-protocol/watch-relay.ts` | Ticket claims, limits, the proof messages, `sealWatchRequest`, `openWatchRequest`, `sealWatchReply`, `openWatchReply`, decoders. |
| `packages/contracts/src/signal-protocol/messages.ts` | Ingress frames `watch-delivery` (Signal to host) and `watch-delivery-result` (host to Signal), and `hello.watchRelay`. |
| `packages/contracts/src/team-protocol/watch-relay-v1.ts` | Team API route `GET /v1/watch/setup` and capability `watch-relay-v1`. |

## Keys

| Key | Owner | Algorithm | Use |
| --- | --- | --- | --- |
| Watch signing key | Watch Keychain (Secure Enclave when available) | ECDSA P-256 | Proof on each ticket request and each relay request. The public key is bound into the watch session and into each watch ticket (`clientPublicKey`). |
| Host watch key | Host, stored encrypted like the ingress queue key (`src/main/ingress-queue-key.ts`) | ECDH P-256 | Opens sealed watch requests. The phone reads the public key from `GET /v1/watch/setup` over its authenticated WebRTC link and gives it to the watch. Signal never receives it. |
| Response key | New for each request, inside the sealed request | AES-256-GCM, 32 random bytes | Encrypts the reply to the watch. |
| Ticket signing key | Account service (the same signer as remote tickets) | ES256 | Signs watch tickets. Signal and hosts check them with the existing key set. |

## Watch session (account service)

- `POST /v2/remote/watch/sessions`, phone account bearer. Body `{ publicKey }`: raw P-256 public key,
  base64url, 65 bytes. Reply `{ watchSessionId, token, expiresAt }`. The token is kept as a hash.
  The session is a child of the phone's auth session: it ends when the parent is revoked or expires,
  and after `WATCH_SESSION_TTL_MS` (30 days). Pairing again with the same key replaces the old session.
  The user has at most 5 watch sessions.
- `DELETE /v2/remote/watch/sessions/:watchSessionId`, phone account bearer. Revokes it.
- `POST /v2/remote/watch/ticket`, watch bearer. Body `WatchTicketRequest { hostId, ts, proof }`.
  `proof` is the watch signature over `watchTicketProofMessage(watchSessionId, hostId, ts)`.
  `ts` must be within `WATCH_RELAY_CLOCK_SKEW_MS`. The user must have an active membership on the
  host. Reply `{ ticket, expiresAt, signalUrl }`. The ticket is an ES256 JWT with
  `aud: "openbot-watch"` and the claims of `WatchTicketClaims`, TTL `WATCH_TICKET_TTL_SECONDS`.
- The watch session is listed with the user's connected devices and can be revoked there.

## Relay request (Signal)

`POST /v1/watch/request` (`WATCH_RELAY_PATH`), header `Authorization: Bearer <watch ticket>`,
JSON body `WatchRelayHttpRequest { v: 1, ts, sealed, proof }`, at most `WATCH_RELAY_BODY_BYTES_LIMIT`.

1. Signal checks the ticket (signature, `aud`, `exp`, revoked auth epoch), the clock, and the proof:
   ECDSA P-256 SHA-256 (IEEE P1363, 64 bytes) by `clientPublicKey` over
   `watchProofMessage(hostId, jti, watchSealedDigest(sealed), ts)`.
2. Rate limits: 60 requests per minute for each watch session, 120 for each IP address.
3. Signal finds the ingress socket of `hostId` that sent `hello.watchRelay: true`.
   - No socket, and the host is a hosted server that sleeps: Signal wakes it as it does for a webhook
     and answers `503 { error: "waking" }`.
   - No socket otherwise: `503 { error: "host_offline" }`.
   - More than `WATCH_RELAY_PENDING_PER_HOST` requests in flight: `429`.
4. Signal sends `watch-delivery { requestId, ticket, ts, proof, sealed }` and waits at most
   `WATCH_RELAY_HOST_TIMEOUT_MS` for `watch-delivery-result { requestId, status, sealed? }`.
   No answer: `504`. Signal never queues a watch request.
5. Signal answers with the host's status. For 200 the body is `WatchRelayHttpReply { v: 1, sealed }`.
6. Signal never logs or keeps a ticket, a proof or a sealed value.

## Host

- `GET /v1/watch/setup` (Team API, any member). Returns `WatchRelaySetup { hostId, watchKey }`.
  The host announces `watch-relay-v1`. A call to setup also makes the host keep its ingress socket
  open with `hello.watchRelay: true` for 30 days after the last setup or relay request.
- On `watch-delivery` the host:
  1. checks the ticket like a remote ticket, but with `aud: "openbot-watch"`, `hostId` of this host,
     the current auth epoch, and an active membership;
  2. checks the proof with `clientPublicKey` and the clock;
  3. opens `sealed` with `openWatchRequest` (nonce `hostId\njti`);
  4. refuses a request `id` that it saw in the last 10 minutes;
  5. runs `request.command` as that member, with the same rules as the phone
     (`apps/mobile/src/features/watch/watch-sync.tsx`): approve only an approval that the watch shows
     in full, never answer a private question, send with `messageId` as the client message ID;
  6. answers status 200 with `sealed = sealWatchReply(responseKey, id, JSON.stringify(WatchResult))`.
- Command errors are a `WatchResult` with `ok: false` inside a 200 reply. Status codes other than 200
  are only for ticket, proof, size and format errors.
- `refresh` returns a `WatchSnapshot` for this host only, in the same shape and order rules as the
  phone builds (`apps/mobile/src/features/watch/model/watch-snapshot.ts`), localized for
  `refresh.language`. `servers` has one entry, this host, with `watchKey`.
- `avatars` returns the agent pictures that the host's snapshot names. `open` is not supported on
  the direct link (the watch uses the phone for it).

## Phone

- The watch sends `pair { publicKey }` on the iPhone link when it has no credentials, or when its
  token expires in less than 7 days.
- The phone creates the watch session, calls `GET /v1/watch/setup` on each server that has
  `watch-relay-v1`, and answers `WatchResult { ok: true, direct: WatchDirectCredentials }`.
  Credentials travel only in a `sendMessage` reply, never in the application context.
- Each `WatchServer` in the phone's snapshot carries `watchKey` when the phone knows it.
- The phone's ready snapshot and the credentials carry `account`, the account scope of the phone's
  session (`apps/mobile/src/shared/lib/account-scope.ts`). When a snapshot from the phone has another
  `account` than the credentials, the watch deletes the credentials and pairs again.
- Sign-out revokes the watch session and sends the `signedOut` snapshot. The watch then deletes its
  Keychain items.

## Watch

- Keychain: signing key, `watchSessionId`, token, `authUrl`, servers; accessible after first unlock,
  this device only.
- Tickets are cached for each host until 60 seconds before they expire.
- After a pairing fails, the watch tries again after 30 seconds; after a pairing that works, after 1 hour.
- Order: for `refresh`, the watch asks each host directly and merges the results in the phone's
  server order; it uses the iPhone link when a host fails. For a command, it uses the direct link
  of the agent's host first, and the iPhone link after a network error, 503 or 504.
- While the app is open, the watch refreshes every 5 seconds when it has direct credentials, else every 15 seconds.
- Background refresh (`WKApplicationRefreshBackgroundTask`) refreshes directly and updates the
  complication.

## Exact algorithms

The watch (CryptoKit) and the host (WebCrypto) must give the same bytes.

- Sealed request: `sealHostGrant` with kind `{ version: 1, info: "openbot-watch-request-v1" }`.
  Ephemeral `P256.KeyAgreement` key; shared secret is the 32-byte x coordinate; HKDF-SHA256 with
  salt = raw 65-byte ephemeral public key, info = the kind info, 32 bytes; AES-256-GCM with a random
  12-byte IV and AAD = UTF-8 of `hostId + "\n" + jti`. Envelope: base64url of the JSON
  `{"v":1,"epk":…,"iv":…,"ct":…}`, where `ct` is ciphertext followed by the 16-byte tag.
- Request plaintext: JSON `{ id, ts, responseKey, command }`, where `command` is the JSON string of a
  `WatchCommand`.
- Reply: AES-256-GCM with the response key, a random 12-byte IV and AAD = UTF-8 of the request `id`;
  value = base64url of IV, ciphertext and tag.
- Proof messages are the exact `JSON.stringify` output of `watchProofMessage` and
  `watchTicketProofMessage`: no spaces, no escaped slashes.
- base64url has no padding.
