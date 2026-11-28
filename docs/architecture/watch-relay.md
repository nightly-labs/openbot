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
  `signalUrl` is always the Signal entry (`REMOTE_SIGNAL_URL`) and the ticket has no `signal` claim,
  because the host's ingress socket always connects to the entry. The host's WebRTC Signal home
  (`remote_hosts.signal_home`) can be another Signal, which has no ingress socket of that host.
- The watch session ends with its phone session: a sign-out on the phone, or a revoke of the phone in
  the connected devices, revokes it too.

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
     the current auth epoch, and a member that is not disabled on this host (a member that the host does
     not know yet is accepted, as for a remote session);
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
  `refresh.language`. `servers` has one entry, this host, with `watchKey`, `color` and `shape`.
- Agents come in the stored sidebar order: pinned agents first, then each folder in layout order, each agent
  with `folder` (the folder path, such as `Parent / Child`). The order does not change with unread state
  or recent activity. The watch shows Pinned, Unread and Needs you sections, then one section per folder.
- `channels` (optional, `WatchChannel[]`) lists the channels that the member sees on the sidebar, not
  archived. Each channel has its `folder` and a `position` in the same sidebar order as the agents, its
  first `WATCH_CHANNEL_MEMBERS` member agent IDs, `unread`, `working`, and the last message (`author`,
  `reply`). The member's sidebar pins (agents and channels) come first, in pin order, with `pinned`;
  agents and channels share the `position` order. `watchChannelsWithinLimit` keeps at most
  `WATCH_CHANNEL_LIMIT` channels for each server: all unread or working channels first, then the others
  in sidebar order. Channel visibility follows the Team API channel routes: an admin sees all channels;
  another member does not see a channel with an agent that the Team API hides from that member.
- `sendChannel { serverId, channelId, text, messageId? }` posts as the member through
  `CHANNEL_ROUTES.command` (`send`). `readChannel { serverId, channelId }` reads the channel up to its
  last message (`CHANNEL_ROUTES.read`, then the `read` command with `throughSequence`). Both fail for a
  channel that the member does not see. A watch on an older snapshot has no `channels` and sends neither.
- `avatars` returns the agent pictures that the host's snapshot names. `open` is not supported on
  the direct link (the watch uses the phone for it).

## Widget push

The watch widgets update late while the watch app is closed. On watchOS 26 and later, WidgetKit
reloads a widget when it gets a widget push. A widget push has no data.

- The watch sends `widgetPush { token, environment }` on the direct link to each host: at app launch,
  when the token changes, and when the last registration on that host is more than 15 minutes old.
  A host that restarts forgets its tokens, so this renewal limits the time with no pushes. The token
  is lowercase hex, 8 to 256 bytes (`WATCH_WIDGET_PUSH_TOKEN_PATTERN`); `environment` is
  `production` or `development` (a simulator build uses `development`). Only a success counts as a
  registration. A `400` from an older host, which refuses the command as invalid, also counts, so the
  watch asks that host again only after the renewal time. After another failure, such as an offline host or a timeout, the watch asks that host again after 60 seconds. The watch app registers in its own task, so a slow host does not stop its refresh. The iPhone link answers `failed`.
- After a widget push, the widget fetches the new state over the direct link when its saved data is
  more than 5 seconds old, and saves it without a reload. The 5 seconds skip a fetch just after the
  watch app saved data and reloaded the widget itself.
- `WatchWidgetPushService` (`src/main/watch-widget-push.ts`) keeps the tokens in memory only, for
  each member, at most 5 for each member. It forgets a token 12 hours after the last registration,
  when the account service answers `410`, when the member is removed or disabled (checked before each
  push and at each expiry), and when the host stops.
- Triggers: on agent events, at most once each 2 seconds, the host reads for each member with a token
  the agents that the member can see: state, wait request IDs, newest reply ID, `updatedAt`, and the
  unread count. It pushes when the agent list, a state, a wait, a reply or `updatedAt` changes, or an
  unread count goes up.
- Limits for each token: an agent that starts to wait is sent at once when the last push was 10
  seconds or more before, else at the end of those 10 seconds. Any other change goes out at most once
  each 60 seconds, as one trailing push. Apple budgets widget pushes.
- The host sends `POST /v2/remote/hosts/:hostId/widget-push` with `{ machineToken, token,
  environment }`. The Worker checks the credential and the per-host APNs rate limit (key
  `widget:host:<hostId>`), and posts `{"aps":{"content-changed":true}}` to APNs with
  `apns-push-type: widgets`, `apns-topic: <watch app bundle ID>.push-type.widgets` (`watchWidgetPushTopic`
  in `apps/auth-api/src/server/live-activity-relay.ts`; the watch app is `<APNS_TOPIC>.watchkitapp`),
  `apns-priority: 5` and a 1-hour expiration. It stores and logs nothing. Answers: `204` sent, `410`
  token gone, `400` refused by Apple or invalid, `429` rate limited, `503` not available.
- On the push, watchOS reloads the widget, and the widget gets the new state over the direct link.

## Phone

- The watch sends `pair { publicKey }` on the iPhone link when it has no credentials, or when its
  token expires in less than 7 days.
- The phone creates the watch session, calls `GET /v1/watch/setup` on each server that has
  `watch-relay-v1`, and answers `WatchResult { ok: true, direct: WatchDirectCredentials }`.
  Credentials travel only in a `sendMessage` reply, never in the application context.
- Each `WatchServer` in the phone's snapshot carries `watchKey` when the phone knows it, and the IDs of
  the agents and channels that the user hid on this phone (`hiddenAgents`, `hiddenChannels`, at most
  `WATCH_HIDDEN_LIMIT` each). These lists live only on the phone, so the watch removes those chats from
  the host's reply when it merges.
- Each `WatchServer` carries the server logo: `color` (the appearance color, or the automatic color of
  `serverPlushHex`) and `shape` (a `ServerAppearanceShape`, `squircle` by default). Both are optional.
  The phone also sends `picture`: the name of a PNG of the server logo as the phone shows it (the
  plush, or the uploaded logo in a rounded square), at most 192 px and 40 000 base64 characters. The
  phone keeps these files in `watch-server-pictures` in the App Group, and the watch loads them with
  `avatars` from the phone only; a host does not send `picture`. The watch shows the picture on the
  home background and in the server rows, and the flat `shape` in `color` while it has no picture. It
  uses the color for the home background, the server rows and the tones of the home text, dots and
  unread badges (`ServerPalette`). When the picture has a
  clear main color, the watch uses that color instead. The agent list shows the same background as the
  home screen, moved by one page, so the logo continues across the two pages. The Settings page, left of the
  home screen, has a switch for these colors (`openbot.watch.theme` in the watch's user defaults). When it
  is off, the home screen and the list are black with no logo, and the Servers list does not change. When a host reply has no
  logo, the watch keeps the one from the phone; with neither, it uses `accent`.
- Each `WatchAgent` in the phone's snapshot can carry `faces` (`waiting`, `working`): the names of the
  agent's picture with that face. The phone draws them; the host does not send faces, so the watch keeps
  the faces that the phone sent.
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
