# Channels, messaging, and mobile

## iPhone Live Activity updates

The phone and a host build the same Live Activity view with `@openbot/team-client`:
`dynamic-island-coordinator.ts` gives the state, and `live-activity-props.ts` turns it into the props
that the widget shows. While the app runs, `use-live-activity.ts` publishes them itself.

iOS stops the app and its connections in the background. So the phone registers the push token of
its activity with the active host (`live-activity-push-v1`, `POST /v1/live-activity/registration`),
with `away: true` when it leaves the foreground. `LiveActivityPushService` in `src/main` keeps the
registration in memory for that session. While the phone is away, each agent event (at most once a
second) reads the runtime snapshot of the agents the member can see and the member's read state,
builds the props, and sends a change. A change of state has priority 10; a change inside a state
waits 5 seconds and has priority 5. An unchanged state is sent again every 10 minutes, so its stale
date moves on; a host that sleeps stops this, and the view then shows that it is out of date. An idle
state ends the activity.

`live-activity-seal.ts` seals the props with keys derived from a secret that the phone makes for
that host (an HMAC of the phone secret and the server ID). The
host sends the sealed text to `POST /v2/remote/hosts/:hostId/live-activity` with its machine
credential. The Worker checks the credential and a per-host rate limit, makes the APNs payload and
provider token itself, and forwards the request. It stores and logs nothing. The widget cannot load a
library, so the phone composes its layout with the two widget keys and the App Group folder, and
`live-activity-open.ts` opens the sealed props with its own SHA-256. Button links that change host
state carry an HMAC signature, which the app checks with the key of the host that the action goes
to, so one host cannot sign an action for another.

## Shared channel chats

Channels are separate from sidebar sections. A channel has one host, a purpose, participating agents,
a selected lead, and linked agent conversations. Agent membership selects who can receive work.
It does not restrict human access: each authenticated server member can read and use its channels.
The Electron app provides the channel interface. A creation dialog provides member search and optional
coordination settings. The chat shows each author and keeps settings in a side panel. Channels use the sidebar
context menu for management and have no Pause or Resume controls. The mobile interface is unchanged.

`ChannelStore` stores the canonical transcript, channel configuration, tasks, assignments, summaries,
execution threads, and human read positions in SQLite. Migration 18 adds these projections without
changing existing agent data. Channel commands use the orchestration log and command receipts.
Messages have stable IDs and per-channel sequences. A channel projection can be rebuilt from its events.
Archiving stops channel work and retains its records. Restore makes the chat available for new messages again. Neither action removes agents or linked conversations.

Each channel-agent pair has a separate execution thread in `projection_threads`. The normal agent
thread is never replaced. Provider sessions, turns, questions, approvals, attachments, compaction,
and restart recovery use the explicit execution thread. These internal execution records do not
create extra navigation entries. The per-agent drain scheduler remains the authority for work.

`ChannelService` selects one owner. A selected recipient has priority, followed by the task attached
to a reply, a reply to a member message that has no task, a clear follow-up to the sole open task,
and a channel with one available member. These selections use no model. Other requests use the
lead's provider, model, and reasoning setting in a separate session with no work tools. The request
supplies the accepted result schema and the channel summary in place of the transcript. Invalid or
stale routing cannot broadcast a request. Routing can select an existing task, ask a question, or
indicate that no work is needed. A selected owner or existing task adds one channel message from the
lead, so the selection is visible and the user can correct it. Deterministic selection adds no
message.

Channel tools retrieve history, assign a child task, transfer ownership, and report results. The
runtime supplies channel and caller identity. A child keeps its parent owner; a transfer changes it.
Only assignments and awaited results start turns. Completed child results are combined before the
owner returns. The limit is eight automatic assignments per root request and two active assignments
per channel. One agent runs at most one work turn across all chats. Declared workspace and browser
resources are serialized; undeclared resources reserve the host. An assignment keeps the resources
it started with until it ends, and a task with an active assignment starts no second owner. These
controls do not restrict provider process privileges.

Each turn receives bounded channel context: purpose, responsibilities, the current request, source
messages and replies, shared decisions, recent messages, and attachment references. A versioned
summary covers older messages, with a sequence and source IDs. Full messages remain retrievable.
The provider acceptance cursor records context delivery. Context packets remain self-contained so
provider replacement or compaction does not remove shared decisions. Unrelated server conversations
are available through paginated retrieval and are not inserted automatically. Agent memories keep
their existing meaning.

Task revisions prevent an old assignment from completing a corrected request. The stored request
keeps its own text and files: only its first dispatch converts the attachment drafts, and a later
dispatch of the same request sends the stored copies again. Stop pauses a task and its descendants
and interrupts active work. Reassign waits for the old assignment to finish stopping. Restart
recovery checks accepted provider work before retrying. Unknown outcomes require attention.
Command, assignment, and result IDs prevent duplicate dispatch and visible results; external side
effects do not have an exactly-once guarantee.

Desktop IPC and remote desktop transports expose `channel-chats-v1` as an optional capability with
separate payload codecs. Released Team API adapters keep their existing meaning. A host advertises
the capability only when its channel service is connected. Unsupported remote hosts show an explanation
in place of channel controls. The account API and Signal service add no channel storage or routing.

Mobile uses the same host channel IDs and `channel-chats-v1` commands. The host database stores
channel settings, members, messages, memories, routines, and read positions. Mobile keeps only an
in-memory view. Reconnect loads the host list again. `channels-changed` events refresh the list and
open channel history, with one request sequence per host and one pending refresh for an event burst.
Closing a channel retains a short message window (up to 50 messages), as single chats do,
and releases larger windows. Only open channels refresh their history. Server removal discards its cached channels and late
responses. The mobile chat list and message history use virtualized lists. Channel member selection
uses static avatar thumbnails without activity subscriptions or animation timers. Channels appear
next to agents in the same list, with up to four static member avatars that fade when the host
is offline. Channel pins share the existing pinned grid and 16-chat limit; local preferences
preserve agent pins and channel pins separately. Hide removes a channel from the home list and
unpins it; the shared Hidden chats sheet restores it. Channel and agent pinning use the same
measured overlay movement, with static folder artwork for channels. Agent and channel screens
use the same mobile `ChatView`, header, message list, reply gestures, composer, camera, and keyboard
motion. Their data adapters provide history, sending, and read positions; channels also provide
author labels and task actions. Channel send retries retain their operation ID and uploaded files.

Mobile channel settings use one native sheet with a nested stack for memories and routines. The
memory and routine editors share their controls with agent settings and use channel API operations.
Channel settings have no provider or model controls because each member retains its own runtime.
No account API, Signal, IPC contract, or database migration changes are required for mobile channels.

## Messaging connections

The agents of a computer can answer in an external chat platform: Slack, and Discord (see
**Discord** below). [messaging.md](../messaging.md) has the setup, the limits and how to add a platform. Every workspace
installs the one OpenBot Slack app (`apps/slack-app`), and the workspace is linked to the host that
connected it. People mention @OpenBot or send it a direct message. The workspace's Slack Orchestrator,
an agent that the connect dialog adds, receives each new conversation, asks its teammates and posts
the answer. Every answer comes from OpenBot.

- **Install.** The desktop asks `POST /v2/slack/authorize` for Slack's install URL, with a one-use host
  key. The Worker exchanges the code at `/v2/slack/callback`, because the app's client secret lives
  there. It links the workspace to the host in D1 (`slack_workspace_routes`: team, host, account; no
  token) and seals the bot token to the host key (`@openbot/contracts/slack-workspace-grant`). The
  page `/slack/connect` opens `openbot://slack-workspace`. Only the account that linked a workspace
  can move it to another of its hosts; another account gets `slack_workspace_taken`.
- **Events.** Slack posts every workspace's events and button presses to one URL,
  `https://signal.openbot.run/v1/slack/events`. Signal checks Slack's signature with the app's
  signing secret, answers `url_verification`, and reads only the app ID and the workspace ID. Each
  signing secret is bound to its app, and a route is one app in one workspace, so the production and
  development apps can share a workspace. It passes the exact body to the `ingress` socket (`SignalIngress` in main, a plain `ws` client: no WebRTC, so no hidden
  window) that holds a route ticket for that workspace, and returns the host's answer within 2.5 s,
  or 503 so that Slack sends it again. The route ticket is an ES256 JWT that `apps/auth-api` signs
  with its own key for a host that proves its machine token. It names only the workspaces that D1
  links to that host, expires after 5 minutes, and the host asks for a new one each time the socket
  connects. Each workspace in the ticket carries the time D1 linked it. When a workspace is unlinked
  or moved, the Worker sends Signal `slack-route-revoked` through the signed auth-event outbox:
  Signal drops the route and refuses tickets with that link or an older one, so a host that lost the
  workspace cannot keep it with the ticket it holds. Signal keeps these revocations in memory, so for
  one ticket lifetime after it starts it asks the Worker (`/v2/remote/slack-route/validate`, signed
  like `/v2/remote/resume/validate`) which links of each ticket D1 still has. The host trusts a delivery because Signal checked the signature; no host has the
  signing secret.

The code has two halves. `MessagingThreads` (`src/backend/messaging/`) is built by `AgentService`
beside `ChannelService` and knows no platform. `MessagingService` is built in the main process and
owns the live connections, through one `MessagingDriver` per platform: an adapter for its API and a
transport for its events. `messaging-types.ts` is the seam; the core never reads a platform payload.

- **Storage.** Migration 25 adds `projection_messaging_connections` (one per workspace, with its
  orchestrator agent) and `projection_messaging_threads` (one per external conversation, with the
  agent that answers it).
  Tokens are not in the database: `MessagingCredentialStore` keeps the bot token encrypted by
  `safeStorage`, keyed by connection, and only its state crosses IPC.
- **Orchestrator.** A message in a thread that has a link goes to the link's agent. A new conversation
  goes to the workspace's orchestrator; without one, Slack is told that no agent answers. The
  orchestrator is a normal agent (`slack-orchestrator.ts`): its description is its standing remit, and
  it starts with five memories, which are facts only, because the model reads memories as data. It
  gives work to one teammate with `send_message`; the request carries `messagingReturn`, so the
  teammate's answer runs as a follow-up turn in the same Slack thread. A turn that only asked a
  teammate posts "A teammate is working on it" (`MessagingThreads.awaitsTeammate`). It goes in the
  sidebar's Integrations section, which `MessagingService` creates the first time; the renderer shows
  that section collapsed.
- **Execution threads.** Each Slack thread is a link with its own execution thread in
  `projection_threads`, as a channel-agent pair is. A direct message is answered in a thread under
  it, so each one is its own conversation. `MessagingThreads.event` takes that thread's conversation
  and turn events, so the public chat, the renderer and Team peers never see them. Approvals still
  reach the host.
- **Deliveries.** An external message is a mailbox message from `user` with a `messaging` origin
  (link, author, platform message). No new sender kind, so the frozen Team protocol codecs are
  unchanged. The queue and the public chat hide it like channel work. A request the agent sends from
  a Slack turn carries `messagingReturn`, the origin of that turn; `MailboxStore.enqueue` gives the
  answer to it that origin as `messaging`, so the answer runs in the same execution thread, and its
  turn posts to Slack as a follow-up. `DrainScheduler` asks `MessagingThreads.prepare` for the thread
  and the prompt, which frames the text as external input and adds earlier messages of the thread.
- **Order.** The one-turn-per-agent rule is unchanged, so Slack requests wait behind the agent's own
  work and behind channel work that holds the host. The Slack thread shows a waiting post.
- **Replies.** `MessagingThreads` reports each turn start and end. `MessagingService` posts a status
  with a Stop button, replaces it with the answer, uploads the files the agent attached, and sets
  reactions. It serializes the posts of one conversation, so a fast turn cannot race its status. No
  post names the agent.
- **Approvals and stop.** An approval of a messaging thread is also posted with buttons. Only the
  Slack user whose message started the turn can answer or stop it; the host can always answer. The
  button value is a random token that exists only in memory.
- **Channels.** When a connection starts, OpenBot joins every public channel it is not in
  (`conversations.list`, `conversations.join`, scope `channels:join`), so people can mention it with
  no invitation. It joins each new public channel on `channel_created`. A private channel needs
  `/invite`.
- **Deduplication.** An in-memory set drops a redelivered event at once; the mailbox idempotency key
  covers a restart. Events that arrive while no socket is open are lost after Slack's retries.
- **Screen.** **Server settings → Connectors → Slack** on the computer that runs the agents shows each
  workspace and its orchestrator, and a two-step dialog connects the workspace and adds the
  orchestrator on the model the user picks (`messaging:*`). A remote server shows
  no Slack page, because the install returns to the host's own browser. A live connection counts as
  use, so a hosted server does not idle out. **Connectors → Discord** is the same page for Discord
  (`SlackIntegrationPanel` with `platform="discord"`).

**Discord.** Every guild installs the one OpenBot Discord app (`apps/discord-app`), and a guild is a
connection with its own Discord Orchestrator (`discord-orchestrator.ts`). Discord pushes a bot's
messages only over its Gateway WebSocket, and the bot token cannot go to each host, so Signal holds
the token and does the platform work for the hosts:

- **Install.** As for Slack: `POST /v2/discord/authorize`, `/v2/discord/callback` (scope `bot`, the
  Worker exchanges the code, revokes the user token it gets, and links the guild in D1
  `discord_guild_routes`), the page `/discord/connect` and `openbot://discord-guild`. The sealed grant
  (`@openbot/contracts/discord-guild-grant`, on `host-grant.ts`) names the guild and holds no token.
  Another account gets `discord_guild_taken`.
- **Events.** Signal keeps one Gateway connection (`@discordjs/ws`) with the guilds, guild messages
  and direct messages intents, and no privileged intent. It passes on only a guild message that
  mentions the bot, and a press of an OpenBot button, which it acknowledges to Discord at once. It
  normalizes each into `DiscordDelivery` (`@openbot/contracts/signal-protocol/discord-api`), takes the
  bot's own mention out, and sends a `discord-delivery` frame to the `ingress` socket that holds a
  Discord route ticket for the guild. The ticket mirrors the Slack one (audience
  `openbot-discord-route`, `/v2/remote/hosts/:id/discord-route`, `discord-route-revoked`,
  `/v2/remote/discord-route/validate`). The socket asks for a route only for the platforms whose
  connections hold it.
- **Removal.** When the bot leaves a guild, Signal drops its route and asks the account service to
  unlink it (`/v2/remote/discord-route/removed`, signed), so an offline host does not keep it. After
  the Gateway lists every guild of the bot, and every 30 minutes, Signal sends those guild IDs
  (`/v2/remote/discord-route/reconcile`), and the account service unlinks each link of another guild
  that is older than five minutes. It sends nothing while a Gateway shard is closed, because the list
  can miss a guild that installed the bot meanwhile. A route ticket that still names a guild the bot is not in is not
  routed. The `discord-session` frame lists the guilds
  routed to the socket; a host connection whose guild is not listed stops, and **Reconnect** starts
  the install again.
- **Calls.** After `ready`, Signal sends the socket a `discord-session` token. The host's adapter
  (`discord-driver.ts`) sends typed operations (`DiscordApiRequest`: post, edit, delete, react, list
  messages, names, a private reply to a button press, upload) to `POST /v1/discord/api` with that
  bearer. Signal accepts an operation only for a guild routed to that socket, and only for a channel
  of that guild, and makes the call with `@discordjs/rest`. Every post has no allowed mention, so it
  pings nobody. Attachments are signed CDN addresses, which the host downloads directly.
- **Conversations.** A conversation is a reply chain, keyed by its first message. Every OpenBot post
  replies to that message, so a reply to an OpenBot post names the conversation through the replied
  post's own reference. A direct message has no guild, so Signal answers it once with a fixed line.

## Mobile chat queue

Mobile reads the host queue, applies `queue-changed` snapshots, and refreshes active queue
queries on `queue-invalidated` events. Both events cancel earlier reads before they update the cache. It does not
run a second delivery loop. Queued and cancelled deliveries stay outside the chat transcript.
The panel uses a bounded virtualized list and one glass surface with a bottom-anchored
transition that respects reduced motion. Its fixed list viewport stays mounted, and the
composer inset changes once per toggle. Streaming does not change the panel's inputs.

The optional `queue-edit-v1` capability and desktop edit IPC provide the same host edit hold.
Held deliveries remain in public queue snapshots with an editing marker. The private edit
identity is not exposed. Only the matching editor can change the held message.
Desktop and mobile write the edit identity before requesting the hold. Each client enables
saving only after confirmation. A failed attachment-retention request keeps the desktop edit
identity and backup available for retry. The mailbox stores
the hold in the existing delivery JSON. The first held delivery blocks automatic queue dispatch;
steer and an update without that edit identity are rejected. Saving commits the replacement
message and releases the hold in one mailbox transaction. Cancel restores normal dispatch without
changing the message. Delete cancels the delivery, finishes its edit, and releases attachment
ownership in the same mailbox transaction. Released edit drafts survive restart until sent or
discarded, so a lost cancellation response cannot destroy a saved composer backup. Ordinary
unretained drafts still expire at host startup. A finished edit identity records the action that
finished it, so a repeat of that same action stays safe after a lost response, while a save that
follows a completed cancel is rejected instead of reporting success for text the host never took. Holds and locally saved edit drafts survive host restart and client navigation; they have
no timeout that could send a message while someone is still editing it. Older hosts retain queue
view, steer, delete and reorder, but mobile disables editing without the capability.

The mobile queue is a route, not a panel. Each chat publishes its live queue controller under its
own identity, and the sheet reads the identity it was opened with, so a chat that the native stack
keeps mounted cannot answer for another chat's open sheet. Queued files are listed as rows: an
image shows its own thumbnail, every other file shows the file icon, and the message options open
a file in the share sheet. The thumbnail reads the attachment through the query key the chat uses,
so a file already read in a message is not fetched again. The editor changes the text, removes the
files the message already has, and adds new ones.
