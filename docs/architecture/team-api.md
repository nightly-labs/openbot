# Team API compatibility

## Team API compatibility boundary

Current remote connections use Team API protocol v5 over three ordered WebRTC DataChannels: `rpc`,
`events`, and `files`. A sandboxed hidden Chromium page owns each `RTCPeerConnection`. Electron main
uses a `MessagePort` and transfers binary data as `ArrayBuffer`. Signal carries SDP and ICE only,
except the Slack requests of an agent's Slack app (see [Messaging connections](channels-and-messaging.md#messaging-connections)).
OpenBot Mobile uses the same ticket, authentication transcript, framing, RPC codec, and event stream.
In Expo Go, an Expo DOM component owns the browser `RTCPeerConnection` inside a hidden WebView and
passes only serializable, validated commands and events to the native React UI; no native WebRTC
module or development build is required.
Mobile server labels in the drawer and connection settings describe the authenticated application
connection, not membership or Signal presence. Each membership has its own transport and recovery controller while mobile is active.
Switching servers changes the visible workspace without closing other connections. iOS `inactive`
transitions leave connections alone. Backgrounding retains the last connection status and pauses
recovery; transport failures received in the background are retained for resume. Only the paired desktop is Local;
other servers are Remote regardless of the account role. Connecting becomes Online after compatibility and workspace synchronization succeed;
transport failures and reconnect attempts show Offline, and protocol failures show Connection error.
The existing RTC connection updates and recovery controller are the source of truth; the indicator
adds no polling or health requests. Foreground resume reuses a healthy connection without a workspace
reload. Canceled reads and event resets request data synchronization without showing a reconnect on
a healthy connection. Invite selection and manual refresh reuse the same controller. A transient RTC
disconnected state has a five-second recovery window, including on resume; failed or closed states
drive recovery immediately. Backgrounding pauses the grace timer and cancels pending reads so they cannot block resume.
Explicit refresh bypasses the retry cooldown without overlapping a pending connection attempt.
The native/DOM mailbox carries concurrent commands by ID. Switching or disconnecting cancels
pending callers immediately; peer generations reject late callbacks from a superseded host.
The persisted hosting preference is restored on startup in both the normal desktop and the
development host. Starting the development HTTP API alone does not publish WebRTC; Mobile Connect
needs the published host. The separate development test-client role never auto-publishes.
Mobile Connect tickets and QR codes bind the started host ID and SHA-256 public-key fingerprint.
Mobile verifies that binding at redemption and against the directory, pins the key, and selects
that host rather than the first account-owned desktop. Legacy unbound QR codes require regeneration.
Desktop invitation QR codes contain the same one-use link as Copy link. The signed-in mobile
scanner validates that link and opens the invitation review before acceptance. These codes join
one server; Mobile Connect codes sign in to the desktop account and select the paired host.
Both clients read account-wide membership from D1's indexed `remote_memberships` / `remote_hosts`
join. An offline paired desktop does not remove other memberships, and mobile connects directly
to each host independently. A cold launch refreshes the account directory. Both clients check again
every 15 minutes while active. Concurrent directory reads coalesce; inactive clients do not poll.
Mobile background entry stops the timer, and foreground entry starts a new 15-minute interval.
iOS `inactive` transitions, including Notification Center, do not trigger a check or reset the timer.
Session revocation, explicit refresh,
and completed invitation acceptance can refresh sooner. A lost healthy connection also requests
membership reconciliation; a transport failure alone never removes a server. Mobile member controls
use the same account endpoints: owners and admins can invite, while only owners can change another
member's role or remove access. D1 retains revoked membership records and invalidates affected
sessions; both clients exclude inactive members from the active list and count. On legacy HTTP(S)
hosts, desktop exposes inactive records separately for removal before a new invitation; it does not
restore the pause/restore controls or change the released invitation rules. Mobile separates shareable
links from email invitations. Email mode creates an address-bound invitation and sends it through
the same delivery endpoint as desktop; failed delivery attempts revoke the new invitation. Released restore endpoints
remain compatible with older clients. Member and invitation lists refresh after changes or on explicit request.
Conversation read cursors belong to a team member and are shared across that member's devices.
Advancing a cursor emits a conversation invalidation without the reader's identity or cursor;
clients reload their own read state even when the conversation content revision is unchanged.
Mobile acknowledges rendered replies only in the foreground, focused chat at the latest messages.
Mobile attachments use the shared desktop filename allowlist in `packages/contracts/src/attachment-files.ts`.
The native document and photo pickers and the in-chat camera panel prepare local drafts. The existing Team file protocol
uploads them to the host before one message commits the ordered draft IDs. Mobile limits each file
to 10 MB because the native/DOM bridge copies Base64 data. Downloads use the same authenticated file
channel, validate size, chunk order, and SHA-256, and pass verified bytes back through the command
bridge. Mobile queues downloads to limit concurrent copies. Image previews preserve aspect ratio;
other files use the system share sheet through a temporary cache file.

Mobile chat loads the latest 50 messages through `conversation-page` and loads older pages by cursor.
Its `FlatList` virtualizes messages and retains the visible position when older pages are added.
Reply references travel with each page. A page with no overlap replaces the cached window so a
reconnect cannot leave an invisible gap. Older-page responses do not advance the live revision.
The in-memory conversation store notifies subscribers per agent and combines streamed text once
per animation frame. Windows above 50 messages are released when their last subscriber leaves;
the complete history remains in the host database. Connection recovery prioritizes observed chats.
Mobile chat keeps viewport, latest-user, and composer measurements in its motion controller. The
last user message anchors a native blank-space inset; streamed replies consume that inset without
autoscrolling. Initial history positioning and the first-send/first-response animation are separate
states. Pending message bubbles reconcile through the host receipt ID, not message text.
Mobile replies use the existing `replyToMessageId` field and retain their source after delivery.
Agent bubbles support swipe-to-reply and a long-press action sheet with haptic feedback. The
sheet has one nested native stack for actions and text selection; message text stays in memory,
outside route parameters. Failed sends restore the reply target, and the composer can cancel it.
Selected mobile attachments use the existing WebRTC file frames followed by the attachment upload endpoint;
the native/DOM bridge limits each file to 10 MB and cancels transfers when its connection is replaced.
The optional `conversation-unread` capability adds a separate `POST /v1/agents/:id/conversation/unread`
operation. Ordinary read acknowledgements remain monotonic; explicit unread resets persist in the
host's SQLite and emit the same invalidation. Older hosts disable only this optional action.
Mobile external links enter through Expo Router's `+native-intent` and the links feature.
Invitation and Mobile Connect tokens stay in a bounded memory store; navigation carries only a
local request ID. Invitations wait through sign-in and show a verified host preview before an
explicit join. Mobile Connect links require confirmation and cannot replace a signed-in account.
The one exception is development builds: `bun run dev:mobile` opens the link with `simctl openurl`,
and a `__DEV__` build redeems it without confirmation only when its account service is a loopback
or private-network `http:` origin. Release builds always use the confirmed flow.
Plugin links open their validated public page in the in-app browser. Unsupported links show a
safe fallback. Permanent invitation metadata comes from the shared Team client; revocation stops
new joins without removing existing members.
iOS associates only `https://openbot.run/join` with `run.openbot.mobile`. Changes to associated
domains require a new native app build and deployment of the website association file. Android
continues to open HTTPS invitations in the browser, whose button opens `openbot://join`. Enabling
verified Android App Links requires the release app-signing certificate's SHA-256 fingerprint,
`/.well-known/assetlinks.json`, and a matching verified `/join` intent filter. No certificate
fingerprint is stored in this repository yet.

Mobile Settings uses one native form sheet with stable detents and a nested Expo Router stack.
Inner pages push within the sheet and use native back navigation; standalone forms remain
fit-to-content sheets. Both reuse SheetScrollView. General, Profile, Connections and About use HeroUI typography and shared
form fields; the appearance picker remains a native Expo UI control. Appearance is device-local in SecureStore;
Uniwind, navigation and native form hosts share the selected light/dark/system theme. Profile
changes and account-session management use the existing account endpoints, with profile writes
conditional on the stored credential still matching the initiating session.
The mobile client uses the same `/v1/me/profile`, `/v1/me/avatar` and
`/v1/mobile-auth/devices?includeDesktop=true` endpoints as desktop; the last route's historical
name does not restrict it to phones. Avatar uploads send validated binary bytes directly through
Expo fetch, without constructing a React Native Blob from a typed array. Profile reads, writes and their UI-state application
are serialized together. A read queued after an edit can apply a newer remote profile; a read
before a later edit cannot overwrite that edit. Results apply only to the initiating login.
Account-session queries are scoped to each login without including credentials in query keys,
cancel when abandoned, and are removed on account transitions. An HTTP 401 clears only its
initiating credential; transport failures retain the session for retry.
Account profile writes enqueue an `account-profile-changed` invalidation in the existing signed
account-to-Signal outbox before returning. Worker `waitUntil` delivers notifications outside the
profile-save response path, with a five-second timeout per request and outbox retries. Signal forwards the optional frame only to authenticated sockets for that
user; the frame contains no profile or credential. Desktop and mobile fetch the profile through
the account API on notification, cold launch, and every 15 minutes while active.
Membership writes enqueue an `account-servers-changed` invalidation the same way, addressed to the
account rather than to a host: accepting an invitation, changing a membership, and registering a
host this account did not have all queue one for the member whose server list changed. Republishing
an existing host rotates its credential without changing a list, and queues nothing. Signal forwards it to every authenticated socket that account
holds, and the frame names no server. That is how a server joined on one device reaches the other
devices of the same account. Desktop window focus does not trigger an automatic account or directory
check; a device holding no Signal socket finds the change at its next 15-minute check.
Mobile uses one shared lifecycle subscription and a refresh controller per account endpoint.
A foreground return checks absolute freshness: successful account and directory responses stay fresh
for 15 minutes, and background time counts toward that deadline. Failed mobile checks retry after
one minute while foregrounded. Concurrent requests share one promise; invalidations received during
a request cause one follow-up after success. iOS `inactive` alone does not reset these deadlines.
Stored mobile sessions become available before startup validation completes; network failures retain
them, and validation results apply only to the initiating login.
Explicit profile invalidations trigger an earlier check and are deferred while mobile is in the
background. Signal readiness does not trigger a profile check; the account timer remains independent
of transport recovery. Failed desktop automatic checks use the same interval.
Each mobile server has one connection recovery owner. It reloads workspace reads on foreground
return without changing a healthy server to `connecting` or disabling its actions. These reads reuse
the existing WebRTC peer and do not request new account sessions or tickets. The first replacement
starts immediately after actual connection loss.
The required compatibility read has a three-second timeout to detect stale open channels. Delays
apply after failed replacements and survive app switches. The peer owns Signal socket recovery,
not full connection retries. Ordinary transport loss does not invalidate the account directory.
Older Signal clients ignore this optional event. API and Signal both need the event support for push;
the periodic check remains the fallback when Signal is unavailable. Unchanged responses do not
publish a new identity. Desktop ignores reads overtaken by a local edit, sign-out or shutdown;
its central-auth change event updates the renderer and host identity. The mobile drawer and Settings
both display the session's name and resolve avatar paths against its account API.

Mobile hidden/pinned chat preferences are device-local, persisted in SecureStore per account API,
account ID and host ID; they are not part of the shared sidebar layout or conversation read state.
Account/device and logical remote sessions deliberately have no time-based expiration; a finite
maximum Date deadline preserves existing numeric wire contracts. Pairing codes, connection tickets,
and Signal resume credentials remain short-lived. Each logical remote session is bound to its
originating account credential. An atomic D1 trigger ends that credential's remote sessions and
queues disconnects on logout/device revoke; other phones stay connected. Legacy unbound sessions
are ended account-wide on revocation because their originating credential is unknown.
Mobile sign-out keeps the encrypted credential and local session until the account API confirms
revocation. If the DELETE response fails, mobile validates that same token: a 401 confirms it is no
longer active and completes sign-out immediately. A successful session check or an inconclusive
network/service error keeps the credential for retry; a late result cannot clear a newer login.
The desktop keeps remote connection errors visible in the workspace during retries. A successful
connection clears the error. A new connection sequence or a return to online reloads the active
workspace without remounting its providers, so failed refreshes retain cached data. Server switches
still dispose the old scope; load generations and scope guards reject late responses.

Hosts opt in with the additive Signal hello `multiplex` flag; legacy desktops keep their one-peer
limit so a second phone cannot replace an existing client's connection. Signal multiplexes
connections by logical session, and the hidden desktop renderer owns a separate
RTC peer for each device. Main keeps authentication, RPC caches, file staging and event streams
separate per peer. Transport cleanup closes local access without revoking a replacement connection.
Settings → Profile → Account sessions lists and revokes both desktop and mobile credentials.
The account API's existing mobile-device routes expose these via `includeDesktop=true`; their
default mobile-only behavior is unchanged. Responses contain session IDs and activity metadata,
never tokens or token hashes, and all operations are scoped to the authenticated account.
Cloudflare issues short ES256 connection tickets and stores the logical session. Signal issues a
10-minute resume token, so a short Signal update does not end an active WebRTC connection. Signal
validates a trusted, non-expired resume token locally. After a Signal restart, the first use of a token
checks the durable control plane once. An expired token also needs one durable check before Signal issues
a replacement. Later reconnects use the in-memory trust cache. This is not a heartbeat.
Session endings and access changes use a durable D1 outbox. Cloudflare sends each revocation to Signal
immediately and retries failed deliveries from a scheduled task. This keeps reconnect validation local
without losing revocations when Signal is temporarily unavailable.

Protocol v1 remains frozen for compatibility fixtures, but its public HTTP, WebSocket, and Cloudflare
Tunnel transport is retired. The old public endpoints return `host_update_required`.

The desktop client starts each remote connection with `GET /v1/compatibility`. The response contains the host application version, the minimum and maximum Team API protocol versions, and host capabilities. The client selects the highest protocol in the shared range. Application SemVer does not select or reject a protocol.

The first released Team API protocol is `1`. All later HTTP requests include `OpenBot-Protocol-Version` and `OpenBot-App-Version`. The event socket uses the `openbot-team-v1` WebSocket subprotocol. A host without the compatibility endpoint is treated as an old host and is blocked. A request without the required protocol headers is treated as an old client and is blocked.

Each protocol has a frozen codec and adapter in `packages/contracts/src/team-protocol`. The v1 HTTP codec owns the fixed route registry and validates JSON requests and responses before the adapter converts current values. Uploads, downloads, and other binary routes use the same negotiated headers and error envelope. The host does not write current service or IPC values directly to the network. Breaking or semantic changes add a new protocol directory and registry entry. A released adapter keeps its original meaning.

Capabilities describe additive behavior. The client sends its capability list when it sets the event scope. The host sends optional events only when the client declared the related capability. A missing capability disables only that feature. An unknown optional event is ignored. A malformed known event closes the connection as `protocol_error` because the client cannot safely apply it.

Team API failures use a JSON error envelope with `error` and a stable `code`. Compatibility codes are `client_update_required`, `host_update_required`, and `protocol_error`. Authentication and network failures are projected to `authentication_required` and `network_unavailable` in the desktop connection state. A confirmed compatibility or protocol error stops data-plane requests and automatic reconnect until the user selects `Retry`, restarts, or updates.

Protocol support has no fixed time or release limit. Removal is an exceptional architecture decision. It requires a security issue, data-loss risk, semantics that cannot be kept, or technical cost that cannot be contained in an adapter. The decision must also include a changelog entry, update instructions, tests for old-client/new-host and new-client/old-host directions, and clear blocking UI.
