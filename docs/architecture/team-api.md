# Team API compatibility

## Team API compatibility boundary

Current remote connections use Team API protocol v9 over three ordered WebRTC DataChannels: `rpc`,
`events`, and `files`. A sandboxed hidden Chromium page owns each `RTCPeerConnection`. Electron main
uses a `MessagePort` and transfers binary data as `ArrayBuffer`. Signal carries SDP and ICE only,
except the Slack requests of an agent's Slack app (see [Messaging connections](channels-and-messaging.md#messaging-connections)).
OpenBot Mobile uses the same ticket, authentication transcript, framing, RPC codec, and event stream.
In Expo Go, an Expo DOM component owns the browser `RTCPeerConnection` inside a hidden WebView and
passes only serializable, validated commands and events to the native React UI; no native WebRTC
module or development build is required.
The host's network route preference (`openbot-remote-network-route-v1.json`) applies to every
remote connection to the computer. With `private`, the host gives WebRTC no ICE servers, and the
hidden page removes each local, remote, and SDP candidate that is not a `host` candidate on a private
address (RFC 1918, 100.64.0.0/10, `fc00::/7`, or `.local`). A change to `private` closes the
connected peers, so each one connects again without the relay. The Remote Desktop runtime reads its
ICE servers from main for each stream and sends them to the viewer, so its media also has no relay.
Its candidates are not filtered; a direct public IPv6 path stays possible.
Mobile server labels in the drawer and connection settings describe the authenticated application
connection, not membership or Signal presence. Each membership has its own transport and recovery controller while mobile is active.
On a return to the app, the selected server connects first; the others become active when it is
online, or after 3 s.
Switching servers changes the visible workspace without closing other connections. iOS `inactive`
transitions leave connections alone. Backgrounding retains the last connection status and pauses
recovery; transport failures received in the background are retained for resume. Only the paired desktop is Local;
other servers are Remote regardless of the account role. Connecting becomes Online after compatibility succeeds and the agents,
the read state and the sections load. These three reads run together. Cached conversations load
again after Online, the open conversation first; a chat that did not load then loads when it opens.
Transport failures and reconnect attempts show Offline, and protocol failures show Connection error.
The existing RTC connection updates and recovery controller are the source of truth; the indicator
adds no polling or health requests. Foreground resume reuses a healthy connection without showing a
reconnect. When the connection from before the background stays (`kept` on the `connect` result) and
no read stopped at background entry, the first attempt only checks the path with the compatibility
read and reads the open chats again; the event stream delivered every event, or an `event-reset`
asks for a full load. A new connection, a stopped read, a refresh and a failed check load the
workspace again. The time away decides what happens to the connection:
after less than 30 s the path is kept. After 30 s the host stopped using the path (ICE consent), so the
peer renews its Signal socket and restarts ICE; a host that dropped the connection answers with a new
fingerprint, and the peer fails at once instead of after a read timeout. A connection that is lost
while a return checks it is replaced at once, with no countdown, as when the check fails. Signal
closes the socket of a suspended phone after its 120 s idle timeout and drops the connection after the
reconnect grace: 10 minutes for a host that multiplexes, 30 s for an older host or an older Signal
(`reconnectGraceMs` in `ready`, `SIGNAL_CLIENT_RECONNECT_GRACE_MS`). After the idle timeout, the grace
and 10 s more, the peer is replaced on the same session at once, without a resume hello, and the
first attempt connects. A move to another kind of network, such as Wi-Fi to mobile data
(`expo-network`, `apps/mobile/src/shared/lib/network-path.ts`), ends the connection, and the recovery
makes a new one on the same session at once (`networkMoved`); the WebView's `online` event does not
fire for such a move. In support logs, an ICE restart after a network move did not bring the path
back within 6 s, and a new connection was up in 1.5–3 s. In other cases, a probe of the path waits up
to 6 s after the start of an ICE restart (`ICE_RESTART_PROBE_MS`) before it judges the path dead. The desktop host closes a connection
at its 11th ICE restart, so the peer counts its restart offers and, after 10, makes a new connection
on the same session instead of an 11th. A new connection to a known host opens its Signal socket while the ticket request runs,
and, with ICE servers less than 30 minutes old, gathers candidates before `ready`; its first offer
holds the candidates gathered so far. A server that was
Online when the app left keeps its Online look during the first attempt after the return, for up to
5 s (`QUIET_RESUME_MS` in `server-connection.tsx`): the server is `resuming`, `showsOnline` is
true, and no reconnect status, faded avatars or faded chat show. A workspace request to a resuming
server waits for Online instead of failing; it fails when an attempt fails, when the app leaves, or
when the server goes. The outbox, the queue, history reloads and the browser view still read the
live `state`. A failed attempt, a cooldown, a protocol stop or the end of the 5 s shows the normal
reconnect status. A server that was not Online when the app left shows its status at once. Canceled reads
and event resets request data synchronization without showing a reconnect on a healthy connection. Invite selection and manual refresh reuse the same controller. A transient RTC
disconnected state has a 15-second recovery window, including on resume; failed or closed states
drive recovery immediately. Signal's `rate_limited`, or a close with code 1008 and no error frame,
makes the next Signal socket wait 60 s; another refusal with code 1008, such as an invalid ticket,
reconnects at once. Backgrounding pauses the grace timer and cancels pending reads so they cannot block resume.
Explicit refresh bypasses the retry cooldown without overlapping a pending connection attempt.
The native/DOM mailbox carries concurrent commands by ID. Switching or disconnecting cancels
pending callers immediately; peer generations reject late callbacks from a superseded host.
The persisted hosting preference is restored on startup in both the normal desktop and the
development host. Starting the development HTTP API alone does not publish WebRTC; Mobile Connect
needs the published host. The separate development test-client role never auto-publishes.
Mobile Connect tickets and QR codes bind the started host ID and SHA-256 public-key fingerprint.
Mobile verifies that binding at redemption and against the directory, pins the key, and selects
that host rather than the first account-owned desktop. Legacy unbound QR codes require regeneration.
A permanent Mobile Connect link uses the same URL and redemption route, so released phone apps
accept it. It has the same host binding and redeems more than once. D1 keeps only its hash. It stops
working when the desktop replaces or revokes it, or when the desktop session that made it ends. The
desktop keeps the link in its encrypted session file and deletes it at sign-out.
`mobile_auth_sessions.connect_link_host_id` records the host whose link signed in a phone. A revoke
signs out those phones, also when the link row went with its desktop session, and the device list
shows each phone's method. `DELETE /v1/mobile-auth/ticket?host=` spends the unused one-time codes of
that host when the desktop cancels the code that it shows.
A phone session is account-wide: the phone opens each host of the account directory, not only the
host of its code. `GET /v1/mobile-auth/devices?host=` lists the account's phones only when that host
is in the directory (an active membership and a device key), so they can open it. With no `host`,
the route returns every phone, as before. The desktop Connected devices list sends its started host
and shows no phones when it has no host identity. Account sessions still list and revoke each phone.
A phone can also sign in with an email code. It requests the code through `/v1/auth/email/start` and
verifies it through `/v1/mobile-auth/email/verify`, which writes the `auth_sessions` row and its
`mobile_auth_sessions` row in one batch; `/v1/auth/email/verify` would make a desktop session. This
session has no host binding: the phone stores `signIn: "email"` with it, connects to every host in
the account directory and pins each host key on first use, as the web client does. A stored session
with no host and no marker is still a legacy QR session and is revoked. The development LAN allow
list keeps both email routes on loopback, because a development code follows from its challenge ID.
Desktop invitation QR codes contain the same one-use link as Copy link. The signed-in mobile
scanner validates that link and opens the invitation review before acceptance. These codes join
one server; Mobile Connect codes sign in to the desktop account. Mobile keeps the paired host as the
default server above the drawer divider until the user changes it, and opens on the first server.
Both clients read account-wide membership from D1's indexed `remote_memberships` / `remote_hosts`
join. An offline paired desktop does not remove other memberships, and mobile connects directly
to each host independently. A cold launch refreshes the account directory. Both clients check again
every 15 minutes while active. Concurrent directory reads coalesce; inactive clients do not poll.
Mobile background entry stops the timer, and foreground entry starts a new 15-minute interval.
iOS `inactive` transitions, including Notification Center, do not trigger a check or reset the timer.
Session revocation, explicit refresh,
and completed invitation acceptance can refresh sooner. A lost healthy connection also requests
membership reconciliation; a transport failure alone never removes a server. Mobile member controls
use the same account endpoints: owners and admins invite, change another member's role, remove access
and end another member's session. Nobody can change or remove the owner, and only the owner ends the
owner's sessions. `canAdministerServer` in `packages/contracts/src/ipc-team-host.ts` is the one role
check for the clients and the host. On a host with an account directory, the Team API member `PATCH`
and `DELETE` write to D1 through `HostService`, so the next directory sync does not undo them; each
sync closes the host sessions of a member that D1 removed, disabled or gave another role. D1 retains revoked membership records and invalidates affected
sessions; both clients exclude inactive members from the active list and count. On legacy HTTP(S)
hosts, desktop exposes inactive records separately for removal before a new invitation; it does not
restore the pause/restore controls or change the released invitation rules. Mobile separates shareable
links from email invitations. Email mode creates an address-bound invitation and sends it through
the same delivery endpoint as desktop; failed delivery attempts revoke the new invitation. Released restore endpoints
remain compatible with older clients. Member and invitation lists refresh after changes or on explicit request.
Conversation read cursors belong to a team member and are shared across that member's devices.
Moving a cursor emits a conversation invalidation without the reader's identity or cursor, only to the
connections of that member; other members get no event, because their read state did not change. The
member's clients reload their own read state even when the conversation content revision is unchanged.
Mobile acknowledges rendered replies only in the foreground, focused chat at the latest messages.
Mobile attachments use the shared desktop filename allowlist in `packages/contracts/src/attachment-files.ts`.
The native document and photo pickers and the in-chat camera panel prepare local drafts. The existing Team file protocol
uploads them to the host before one message commits the ordered draft IDs. Mobile limits each file
to 10 MB because the native/DOM bridge copies Base64 data. Downloads use the same authenticated file
channel, validate size, chunk order, and SHA-256, and pass verified bytes back through the command
bridge. Mobile queues downloads to limit concurrent copies. Image previews preserve aspect ratio.
Audio and video play in the chat. Other files take the desktop preview kind from
`filePreviewKindForFile`: Markdown, text, HTML, PDF and `.xlsx` files open on the preview screen.
The `.xlsx` parser in `packages/contracts/src/spreadsheet-workbook.ts` runs in a DOM component,
because it needs `DOMParser`. iOS shows a PDF in a native web view with no scripts; Android draws
its pages with pdf.js in a DOM component. A visual reply shows its page in the chat, with no
scripts. Files with no preview use the system share sheet through a temporary cache file.

Mobile chat loads the latest 50 messages through `conversation-page` and loads older pages by cursor.
Its Legend List (`KeyboardAwareLegendList` from `@legendapp/list/keyboard`) renders only the rows near
the viewport, gets every loaded message, and retains the visible position when older pages are added.
A row renders again only when its message changes; other row state comes from a React context.
Reply references travel with each page. A page with no overlap replaces the cached window so a
reconnect cannot leave an invisible gap. Older-page responses do not advance the live revision.
The in-memory conversation store notifies subscribers per agent and combines streamed text once
per animation frame. Windows above 50 messages are released when their last subscriber leaves;
the complete history remains in the host database. Connection recovery prioritizes observed chats.
Mobile chat keeps viewport and composer measurements in its motion controller. The last user
message is the list's `anchoredEndSpace` anchor: the list adds a blank-space inset under it, and
streamed replies consume that inset without autoscrolling. Initial history positioning and the
first-send/first-response animation are separate states. Pending message bubbles reconcile through
the host receipt ID, not message text.
Mobile replies use the existing `replyToMessageId` field and retain their source after delivery.
Agent bubbles support swipe-to-reply and a long-press action sheet with haptic feedback. The
sheet has one nested native stack for actions and text selection; message text stays in memory,
outside route parameters. Failed sends restore the reply target, and the composer can cancel it.
Selected mobile attachments use the existing WebRTC file frames followed by the attachment upload endpoint;
the native/DOM bridge limits each file to 10 MB and cancels transfers when its connection is replaced.
The optional `conversation-unread` capability adds a separate `POST /v1/agents/:id/conversation/unread`
operation. Ordinary read acknowledgements remain monotonic; explicit unread resets persist in the
host's SQLite and emit the same invalidation. Older hosts disable only this optional action.
That route marks the whole chat. The optional `conversation-unread-from-v1` capability (protocol 9
only, `packages/contracts/src/team-protocol/conversation-unread-from-v1.ts`, host route
`src/main/team-api/route-conversation-unread-from.ts`) adds `POST /v1/conversations/unread-from` with
`{ agentId, fromMessageId }`: the member's read mark moves to the message shown before it, and the
answer is the new read state. It needs `view` on the agent, as the other read routes do. A message
the chat does not show is not found. The phone's message sheet and the desktop message menu on a
joined server use it for Mark unread. After it, the open chat does not read itself again until it
opens again. The chat shows a NEW line above the first unread message. The line keeps the message
that the host had as first unread when the chat opened, because the open chat then reads itself.
Mobile external links enter through Expo Router's `+native-intent` and the links feature.
Invitation and Mobile Connect tokens stay in a bounded memory store; navigation carries only a
local request ID. Invitations wait through sign-in and show a verified host preview before an
explicit join. Mobile Connect links require confirmation and cannot replace a signed-in account.
The one exception is development builds: `bun run dev:mobile` opens the link with `simctl openurl`,
and a `__DEV__` build redeems it without confirmation only when its account service is a loopback
or private-network `http:` origin. Release builds always use the confirmed flow.
Plugin links open their validated public page in the in-app browser. Unsupported links show a
safe fallback. On iOS the share extension sends a share by itself, without the app: it shows the
agents, and a hidden web view runs `share-sender.html`, a build of the Team client
(`apps/mobile/src/features/share/extension/share-sender.ts`) that connects, uploads the files and
sends the message. The extension makes every account service request itself and refuses any other
origin. It reads the servers in the app's order, the agents with their avatar pictures, the accent
and the localized text that `ShareExtensionSync` writes to the App Group, and the session from a
keychain group that only the app and the extension share. The app donates `INSendMessageIntent`
for each agent it sends to, with its avatar, so the share sheet offers those agents first. With no data, the app lock on, a share that one message cannot hold, or a failed send that the
user gives to the app, the extension opens `openbot://expo-sharing` as before. Android always uses that
path. The share waits in native storage through sign-in. The share
sheet moves its files into the app cache, the user chooses an agent, and that chat's composer gets the
text and files, which follow the attachment rules above. The phone reads the response headers of a
shared link; a link to an image of at most 10 MB is downloaded and comes as a file instead of the link. Permanent invitation metadata comes from the shared Team client; revocation stops
new joins without removing existing members.
iOS associates `https://openbot.run/join` and `https://openbot.run/agents/*` with `run.openbot.mobile`. Changes to associated
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
one minute while foregrounded. Concurrent requests share one Effect result through a Deferred; invalidations received during
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

From protocol 8, provider ids and auth kinds are open values. A new provider is a new value, not a
new protocol. A client keeps an agent of a provider that it does not know, and shows it disabled
with an update prompt. See [Providers](providers.md) for the frozen lists that hide new providers
from peers below 8.

Protocol 9 is the protocol 8 wire with capability lists of up to 256 names (`v9.ts`). Protocols 7
and 8 read at most 128 capabilities, and their lists are full. A capability added after them is in
`TEAM_PROTOCOL_V9_ONLY_CAPABILITIES` (`current.ts`): a host leaves it out of the compatibility list
of a peer below 9, and a client sends it only to a host that negotiated 9. On WebRTC, where no
protocol header is sent, the marker `long-capability-lists-v1` says that a peer reads 256. It is in
the bootstrap list, so the first compatibility read of a protocol 9 host is already complete.

Capabilities describe additive behavior. The client sends its capability list when it sets the event scope. The host sends optional events only when the client declared the related capability. A missing capability disables only that feature. An unknown optional event is ignored. A malformed known event closes the connection as `protocol_error` because the client cannot safely apply it.

The optional `agent-memories-v1` capability adds three POST routes. `/v1/agent-memories/page`
returns up to 256 memories. `/v1/agent-memories/selection` returns up to 256 selection records,
the agent ID, and essential-memory byte usage. Both use ascending memory IDs and an `after`
cursor (`null` for the first page). Clients validate owner and cursor order. Edits do not move IDs
between pages. Reads across several pages are not an atomic snapshot; the next refresh sees
concurrent changes. `/v1/agent-memories/inclusion` changes up to 25 selections with expected
revisions and returns an empty acknowledgement; the client then reads selection pages again.
Each route requires authentication and a visible agent. Selection writes use the same member
access as existing memory writes. User choices override automatic selection.

The released full-list GET route, memory shapes, and 2 MiB frame limit stay unchanged. A new
client connected to an older host keeps text editing and hides selection controls. An older
client can edit text on a new host without changing inclusion. Storage choices remain 64, 128,
256, and 512. Lowering the setting never deletes existing entries.

Only essential memories enter startup instructions, in a block limited to 8,192 UTF-8 bytes.
Claude gets that block with a user turn instead: the full block in the first turn and after a
compaction, and only the change after a memory edit. A memory change then keeps the cached
system prompt and does not restart the Claude query. A profile change still restarts it.
Saved memories stay on the host in SQLite. Agents can use bounded local search and ID-paged
listing to recall other entries. FTS5 uses `unicode61` and BM25. Queries match any literal term.
`unicode61` has no stemming, so a term of 6 or more characters also matches as a prefix of its first
characters, all but the last 3 and at least 4: "closing" also finds "closes". Equal scores use the newest update, then the memory ID. Search returns at most 10 entries,
and maintenance pages return at most 25. Both responses are limited to 8,192 UTF-8 bytes.
The search index stays local. Essential prompt text and requested tool results go to the active
provider through the existing secret-redaction path.

Selection metadata is separate from the released memory shape. Migration 32 preserves memory
text, IDs, and dates, and selects recent manual entries before recent automatic entries. The same
serializer checks the complete prompt block during migration, mutation, and prompt generation.
Automatic text and selection changes stay pending until the turn completes successfully. Commit
checks ownership, revisions, user choices, and capacity again. Agent tools cannot change or delete
a user-controlled selection. The user can release that control without changing its inclusion.

The optional `message-delete-v1` capability (protocol 9 only) adds three POST routes that delete one
message and return an empty acknowledgement: `/v1/messages/delete` (`agentId`, `messageId`),
`/v1/messages/delete-task` (`agentId`, `taskId`, `messageId`) and `/v1/channels/messages/delete`
(`channelId`, `messageId`). The host always advertises it to a protocol 9 peer, because every host
that has the routes can delete. `src/main/team-api/route-message-delete.ts` owns the authorization.
In an agent chat, the agent must be visible to the member (else 404), and the member needs `chat` on
the agent to delete their own messages; `manage` lets them delete any message. In a channel, each
member deletes their own messages, and owners and admins delete any message. A host without channels
answers the channel route with 400 `channelsUnsupported`, as it answers each channel route. A refusal
from the service gets 403 (not the member's message), 404 (no shown message with that ID) or 409 (the
message is in a running turn), with the host's sentence. A delete removes the message from the host's
history, search and attachments; the provider session can still remember it. The host sends its
usual change events (`conversation-invalidated` and `channels-changed`), so other members refresh.

The optional `chat-history-v1` capability (protocol 9 only) adds four POST routes with an empty
acknowledgement: `/v1/agent-history/delete` (`agentId`), `/v1/channels/context/clear`,
`/v1/channels/context/compact` and `/v1/channels/history/delete` (each `channelId`). They do on a
joined server what "Delete history" of an agent chat, and "New conversation", "Compact now" and
"Delete history" of a channel do on this computer. The host always advertises it to a protocol 9
peer. `src/main/team-api/route-chat-history.ts` owns the authorization. An agent history delete needs
a visible agent (else 404) and `manage` on it (else 403). A member who sees a channel starts a new
conversation or compacts it; only owners and admins delete its history (else 403
`membersCannotDeleteChannelHistory`). A host without channels answers the channel routes with 400
`channelsUnsupported`. Work that still runs or waits, an archived channel, or a compaction that no
member session can do, gets 409 with the host's sentence.

The optional `agent-welcome-v1` capability (protocol 9 only) changes no route shape. A client that
sends it says that the `initialMessage` of `POST /v1/agents` is a setup message for the new agent. The
host stores that message with `welcome: true` in its mailbox JSON and the item type `agent_welcome`.
No conversation page, live snapshot, read state, search result, queue, runtime `work` item or preview
shows it, for any member. While it waits or runs, the host's local queue snapshot has `welcome: true`, so
the host's own window shows that the agent works and not the empty chat. `GET /v1/agents/:id/queue`
keeps its released keys and does not send the flag: a remote member sees the empty chat until the
welcome turn starts. The agent answers it, and that answer shows as usual. A client sends a setup message only to
a host that advertises the capability; an older host still gets the released role text, which stays
a visible user message there.

Team API failures use a JSON error envelope with `error` and a stable `code`. Compatibility codes are `client_update_required`, `host_update_required`, and `protocol_error`. Authentication and network failures are projected to `authentication_required` and `network_unavailable` in the desktop connection state. A confirmed compatibility or protocol error stops data-plane requests and automatic reconnect until the user selects `Retry`, restarts, or updates.

Protocol support has no fixed time or release limit. Removal is an exceptional architecture decision. It requires a security issue, data-loss risk, semantics that cannot be kept, or technical cost that cannot be contained in an adapter. The decision must also include a changelog entry, update instructions, tests for old-client/new-host and new-client/old-host directions, and clear blocking UI.
