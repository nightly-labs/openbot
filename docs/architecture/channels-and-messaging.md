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

## iPhone notifications

A host sends an iOS notification when an agent finishes a turn, stops with an error, cannot start a
message or a routine run (`error` with the code `delivery_start_failed`), or waits for input, an
approval, or a step in the browser (`browser-takeover-requested`, also for a password or a code).
The desktop and the web client notify about the same events (`agentEventCanNotify`), and all three
decide as one: `notificationForAgentEvent` in `@openbot/team-client` applies the level of the server
(`all`, or `needs-me` for the events that wait for the user), the switch of the agent, and the quiet
routine runs. The desktop and the web client close the notification of a request when an
`agent-input-resolved` or `browser-takeover-resolved` event comes, also for an answer from another
device. The title is the agent name. When the phone shows previews, the text is the
preview of a desktop notification: the start of the answer of that turn, the question, or the action
to approve, with secrets redacted. Otherwise it is the fixed desktop text, such as "Finished working.".

Channels are an exception. The desktop and the web client notify an agent reply in a channel from
the channel list (`channelReplyNotifications`), because the channel service consumes the
`turn-completed` event of a channel thread. On a host with `channel-attention-v1`, each summary names
the author and status of its newest message, the thread of each member, and `openTasks`: its
queued, waiting and running tasks. The released `activeTasks` counts only running tasks, so it is 0
while a task waits for the tasks it passed on. A reply notifies once, when the work of the channel
ends (its newest message is an agent's and stopped streaming, and `openTasks` is 0), while the
channel has unread messages. Work that writes many messages, asks a question on the way, or passes
parts to other agents thus notifies once, at its end. The desktop reads the agent list for a
notification only when a reply is new, and it reads no channel list for a server whose replies
cannot notify. The title of a prompt, an approval or
a takeover on a channel thread names the agent and the channel (`notification.channelTitle`), and a
click opens the channel. The phone gets no channel reply notification. For a phone that sends
`channel-attention-v1`, the host names the channel in the title of a prompt, an approval or a
takeover on a channel thread (`PushNotificationService` reads `HostService.channelForThread`), and a
tap opens the channel. An older phone gets the agent name as the title, as before.

The phone registers with every connected server that supports `push-notifications-v1`
(`POST /v1/push-notifications/registration`): the APNs token of the app, the secret of that host (the
same one as for the Live Activity), the language, the level, a mute end, the preview switch, the sound
(`none` when Play sound is off), the start of its Live Activity of that host, and `away`. One sound is for notifications and the Live Activity. With
notifications off, Live Activities on and Play sound on, it registers with no token: the host then
sends no notification, and uses the registration only to make the Live Activity play the sound. It
tells each host again after each connection and when a choice changes, and removes the registration
when nothing is left for that host or the user signs out. A level of
"Nothing" and a mute with no end remove it too. `PushNotificationService` in `src/main` keeps the
registrations in `openbot-push-notifications-v1.json` in the user data folder, readable only by the
user, so a phone that does not connect after the host restarts still gets notifications. It sends
only while the phone is away or its connection is closed. No event goes while the member uses a
desktop app, which shows the event and asks for input, an approval, or a browser step itself: that
computer had input in the last 30 seconds (`powerMonitor.getSystemIdleState`), and
the window of the host's own desktop app has focus or shows the event as a desktop notification, for
the owner (`desktopShowsAgentEvent`: desktop notifications on, and the mute and the level of this
computer's server let the event through); or the member sent, answered, or typed from another session in the last 30
seconds (`TeamApiServer.lastMemberUseElsewhere`, kept in memory). The time is short because a task
can end at any time after the member leaves the computer. While the phone shows a Live Activity of
this host that iOS still updates (8 hours from its start, which the phone gives because a host that
restarted does not know it), the host sends no notification
(`LiveActivityPushService.showsEvent`). With a sound (Settings > Notifications > Sound), the next
update of the activity alerts at once, so iOS lights up the screen, shows the activity, and plays
that sound; with Play sound off, the activity updates silently. iOS does not tell the host when
the user removes the activity, so until the app runs again such an event shows nowhere.

`push-notification-seal.ts` seals the notification with keys of their own, made from the host secret.
The host sends it to `POST /v2/remote/hosts/:hostId/notification` with its machine credential and the
account session of the phone. The Worker checks the credential and a per-host rate limit, and sends
nothing for a session that has ended, a revoked membership, or a signed-out device, because the host
does not learn about these. It makes the APNs alert itself, with "OpenBot" as the only text,
`mutable-content`, the sound, and the sealed bytes. It stores and logs nothing. A `410` answer, from
the Worker or Apple, removes the registration.

The Notification Service Extension of the app (`apps/mobile/plugins/with-notification-service.js`,
`NotificationService.swift`) opens the seal with the keys that the app writes into the App Group
file `push-notifications.json`, and shows the agent name and the text. It refuses content that names
another server than the one whose keys open it. A notification that it cannot open keeps the app
name only. A tap opens the chat of the agent.

## Android notifications

An Android phone gets the same notifications in the same conditions, through Firebase Cloud
Messaging. Android has no Live Activity, so the host does not check one. The phone registers with
every connected server that supports `push-notifications-android-v1`
(`POST /v1/push-notifications/android-registration`): the Firebase token of the app, the secret of
that host, the language, the level, a mute end, the preview switch, and the sound. A registration
always has a token. `PushNotificationService` keeps it in the same file, as an entry with
`platform: "android"`; a host from before this capability drops such an entry when it reads the file.

The host sends the sealed notification to `POST /v2/remote/hosts/:hostId/android-notification`. The
Worker checks the credential, the notification limit of the host and the session, as for an iPhone.
It signs an OAuth token with the Firebase service account key (`FCM_SERVICE_ACCOUNT`) and sends a
high-priority data message with `sealed` and, unless the notification is silent, `sound`. It stores
and logs nothing. Firebase answers `UNREGISTERED` or `SENDER_ID_MISMATCH` for a token that no longer
reaches the app, and the Worker answers `410`, which removes the registration.

`OpenBotMessagingService.kt` (`apps/mobile/modules/android-notifications`) gets the message, also
while the app does not run. It opens the seal with the keys that the app writes into
`push-notifications.json` in its files folder, and gives the notification to `expo-notifications`,
so a tap reaches the app as on iOS. Android plays the sound of the notification channel, so the app
makes one channel for each sound (`android-notification-channels.ts`), and the service picks the
channel of the sound in the message.

Notifications only inform; they have no buttons on either platform. An answer from a button would
have to reach the computer over the WebRTC connection of the app, which Android does not let a
closed or frozen app build: React Native stops its timers and its view updates in the background,
and the web view that holds the connection does not connect again after Android froze the app.

## Shared channel chats

Channels are separate from sidebar sections. A channel has one host, a purpose, participating agents,
a selected lead, and linked agent conversations. Agent membership selects who can receive work.
It does not restrict human access: each authenticated server member can read and use its channels.
The Electron app provides the channel interface. A creation dialog provides member search and optional
coordination settings. The chat shows each author and keeps settings in a side panel. Channels use the sidebar
context menu for management and have no Pause or Resume controls. The mobile app has its own channel
interface (see below).

`ChannelStore` stores the canonical transcript, channel configuration, tasks, assignments, summaries,
execution threads, and human read positions in SQLite. Migration 18 adds these projections without
changing existing agent data. Channel commands use the orchestration log and command receipts.
Messages have stable IDs and per-channel sequences. A channel projection can be rebuilt from its events.
Archiving stops channel work and retains its records. Restore makes the chat available for new messages again. Neither action removes agents or linked conversations. The sidebar calls archiving "Delete". On desktop and web, the row menu in Deleted channels restores a channel; it shows to the people who can delete one.

Each channel-agent pair has a separate execution thread in `projection_threads`. The normal agent
thread is never replaced. Provider sessions, turns, questions, approvals, attachments, compaction,
and restart recovery use the explicit execution thread. These internal execution records do not
create extra navigation entries. The per-agent drain scheduler remains the authority for work.

`ChannelService` selects the owners of a request. A selected recipient has priority, followed by the
task attached to a reply, a reply to a member message that has no task, a clear follow-up to the sole
open task or to the open root tasks that several members own for one request, and a channel with one
available member. These selections use no model. Other requests use
the lead's provider, model, and reasoning setting in a separate session with no work tools. The
request supplies the accepted result schema and the channel summary in place of the transcript.
Routing selects each member whose role or area the request touches, and only those (`agentIds`). A
request in the area of one member, or in the area of no member, goes to the one member best able to
answer it. A request for opinions or feedback on shared work goes to each member whose area gives a
different view, and a request to the whole group goes to all of them. Each selected member gets its own root task for the same request message, answers in its own reply, and
gets the request's attachments; its packet names the other members that answer, but does not carry
their replies to that request, so each member gives its own view. This stays true after a typed
"continue" makes the follow-up the request of a task: the replies count from the first request. After
the member wrote its own complete reply or result (not commentary), a follow-up gets the other replies, so it can ask about them. The packet cursor stops before the
first reply it leaves out, so a later turn of that session gets it. A member that the
model names but that cannot take work is left out. Invalid or stale routing cannot broadcast a
request. Routing can select an existing task, ask a question, or indicate that a message needs no answer.
An existing task that routing selects keeps its instruction, and the new message is its follow-up.
Each selected owner or existing task adds one channel message from the lead, so the selection is
visible and the user can correct it. Deterministic selection adds no message, and a lead that selects
only itself adds none: its reply shows who answers. A routing answer that does not decode pauses the
task with `channelRoutingUnreadable` and offers Reassign. The log gets the answer length and its
field names only, not its text.

A message that opens with agent mentions ("@A @B what do you think?") goes to each mentioned member
that can take work, with no routing turn. A message that opens with `@everyone` goes to each member
that can take work. `@everyone` is plain text, not a tag; the channel composer's mention picker
offers it. The host reads the address from the text (`leadingAddress`), so a client that sends only
the first mention in `recipientAgentId` reaches all of them, and the Team API wire does not change.
A message that opens with a typed "@Name" and no tag goes to the member with that exact name
(case-insensitive, the longest name wins), also with no routing turn. The host reads it; the contract
parser does not change. A routine run reads its text in the same way. A request to more than one
member does not continue the task of the message it replies to. "continue" (or "resume", "go on",
"keep going") continues each stopped root task of the newest request that has one. A failed root
task continues only when no root task is stopped. When the message has a recipient, that member's
own stopped (or else failed) task continues first. Older open work does not block it, and a member
that still works stays as it is. A resumed task keeps its instruction; the dispatch and the packet
add the new message as a follow-up line. A child task gets the follow-up only when the message
replies to that task, because a new child task has the request of its parent. A request that needs routing in a channel with no lead stops with the reason
`channelLeadRequired`. A save that sets a new lead queues these requests again, and the lead routes
them. A lead change does not move a task that already has an owner. The member packet names the lead
(`leadAgentId`).

Channel tools retrieve history, assign a child task, transfer ownership, and report results. The
runtime supplies channel and caller identity. A child keeps its parent owner; a transfer changes it.
Only assignments and awaited results start turns. Completed child results are combined before the
owner returns. The limit is eight automatic assignments per root request and two active assignments
per channel (`CHANNEL_PARALLEL_LIMIT`).

A member can also change its channel when a person asks: `channel_add_member`,
`channel_remove_member`, `channel_set_instructions`, and `channel_list_routines`,
`channel_create_routine`, `channel_update_routine`, `channel_delete_routine` for the schedule
routines. They act only on the channel of the running task (`channel-management.ts`). The request
message of the root task must have a person as author. A routine run (author id `routine:<id>`)
and a request that only an agent wrote are refused, so untrusted run input cannot change the
channel. A member change is a `save` through the command queue, with the draft read from the stored
channel when its turn comes. The caller cannot remove itself or an owner of a task above its own,
and removing the lead clears the lead. An agent that a person adds must be one that person can chat
with, and one they remove must be one they can see: main answers `personAgentLevel` with the level
their own Team API save has (`HostService.channelPersonAgentLevel`). For a team member's request,
the routine tools do not list, make or change a one-time routine, which the Team API does not carry
(`HostService.channelPersonIsRemote`). A retried call finds the
receipt of its change and changes nothing again. Each change
writes a `channel-change` note in the same commit, with the agent as author and a source text that
names the agent, the change and the person. Clients show it as an activity row, and it is not
unread and not in the model packet.

Channel work holds only the agent that does it. An agent runs one main-lane turn at a time: its chat,
a channel delivery or a messaging delivery. While the agent has an active assignment,
`ChannelService.mayDrain` holds its other main-lane requests. The work of other agents does not hold
it. The tasks of the agent run beside the channel turn within the agent task limit, and a channel
turn takes no task slot. When the provider of the agent runs one turn at a time (`concurrentTurns:
false`), its task turns count as busy. Only declared `browser` and `workspace:<path>` resources are
serialized: the same browser, or two workspaces where one path contains the other. An empty list,
`none`, and `host` (from an earlier version) reserve nothing. An assignment keeps the resources it
started with until it ends, and a task with an active assignment starts no second owner. An update
still waits for channel work on all of the host (`hasActiveWork`). These controls do not restrict
provider process privileges.

A channel turn can use `ask_ui`, the plan card (`acknowledge_request`) and `html_render`. The
question, the card and the visual reply are copied into the channel, so each member who reads the
channel sees them and can answer. Screen capture in a channel turn always asks, also with Full
access, and the reason names the channel (`status.agent.screenCaptureChannel`). Messaging links
still refuse these tools. `history_search`, `history_read` and `start_task` stay refused in a
channel turn; `channel_history` gives the channel history.

A hidden lead does not route. When the user hides an agent, `ChannelService.releaseAgent` gives its
queued and starting assignments back to the channel. The task keeps its owner and gets a new
revision, so the work continues after restore or after a reassign. When an agent that owns waiting
channel work (`ownsWaitingWork`) reaches its usage limit, the agent moves to its backup model as for
its own chat. The model-switch marker shows in the agent chat and in each affected channel.

A one-time routine of a channel stays on this computer. The released Team API channel codec does
not accept its schedule, so desktop IPC allows it only on the local host.

Each turn receives bounded channel context: purpose, responsibilities, the current request, source
messages and replies, shared decisions, recent messages, and attachment references. A versioned
summary covers older messages, with a sequence and source IDs. Full messages remain retrievable.
The provider acceptance cursor records context delivery. Context packets remain self-contained so
provider replacement or compaction does not remove shared decisions. Unrelated server conversations
are available through paginated retrieval and are not inserted automatically. Agent memories keep
their existing meaning. A packet leaves out a member's thinking, and the commentary of a turn that
posted a `channel_result`: the result is the answer of that turn.

The channel copies the assistant rows of a member's execution thread. The first rows of a turn go
to the running assignment before it knows the turn id; a row of another turn does not. A new row
of an assignment that has ended is not copied: a turn sends its final rows before it completes, and
after a restart the provider history import can write an old turn again with new row ids. An empty
row is not copied until its first text arrives.

Task revisions prevent an old assignment from completing a corrected request. The stored request
keeps its own text and files: only its first dispatch converts the attachment drafts, and a later
dispatch of the same request sends the stored copies again. Stop pauses a task and its descendants,
interrupts active work, and sets the reason `channelTaskStopped`. The clients show Continue and
Reassign for a paused task that has a reason. A turn that ends interrupted gets the same reason. An
archive pauses work with no reason; a restore gives those tasks the stop reason. Startup gives the
stop reason to a paused task with no reason in a channel that is not archived: older versions stopped
with no reason. Reassign waits for the old assignment to finish stopping. Restart
recovery checks accepted provider work before retrying. Unknown outcomes require attention.
Command, assignment, and result IDs prevent duplicate dispatch and visible results; external side
effects do not have an exactly-once guarantee.

Desktop IPC and remote desktop transports expose `channel-chats-v1` as an optional capability with
separate payload codecs. Released Team API adapters keep their existing meaning. A host advertises
the capability only when its channel service is connected. When a host does not advertise
`channel-chats-v1`, the renderer hides the channel controls in the sidebar, search and schedule. The account API and Signal service add no channel storage or routing.

Mobile shows channels only on a host that advertises `channel-chats-v1`, and Delete and Restore only
with `channel-delete-v1`. It uses the same host channel IDs and commands. The host database stores
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
author labels and task actions. Channel send retries keep their operation ID and uploaded files.
A channel message shows plan cards and `ask_ui` questions as an agent chat does; it has no reactions,
because the reaction route is an agent route. A channel send is done when the host accepts its
operation: the host stores a repeated operation once. The send then reads the history of an open
channel, so the host's row replaces the phone's own; a failed read is not a failed send, and a closed
channel reads its history when it opens. A channel message that an app before channels came back
kept aside in `messages.unreadable-<time>.json` stays there.

On a host with `channel-attention-v1`, each channel summary names the threads of its members. The
channel then shows the approvals and browser steps of those threads, and the agent's own chat does
not. An older host gives no threads: the channel shows the approvals of the members that run one of
its tasks, as before. A member with a request in the channel shows as waiting there, with the reason
of the request. The agent's own chat does not show a turn of another thread (the activity keeps the
`threadId` of its events); for a channel thread, a card under the chat names the channel and opens it. Its home row says that it waits
in that channel in place of its last message (`useWaitingChannel`).
The channel header always has the browser button. It opens the browser of the member that asks for
a browser step, else of the lead, else of the first member. In a channel with more than one member,
the agent in the browser header is a glass button with a menu that switches to the browser of any
member. The Deleted channels sheet restores a channel (`restore`) for the people who
can delete one. The phone has no local notifications of channel replies: a host sends a notification
only while the phone is away (see iPhone notifications). A tap on a notification whose thread is a
channel thread opens the channel, when the phone has the channel list of that server.

Mobile channel settings use one native sheet with a nested stack for memories and routines. The
memory and routine editors share their controls with agent settings and use channel API operations.
Channel settings have no provider or model controls because each member retains its own runtime.
No account API, Signal, IPC contract, or database migration changes are required for mobile channels.

## Messaging connections

The agents of a computer can answer in an external chat platform: Slack, Discord (see **Discord**
below) and Telegram. [messaging.md](../messaging.md) has the setup, the limits and how to add a
platform. Every workspace
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

Telegram uses the same socket with one difference: one OpenBot bot serves every user, so its token
must not reach any host. Only Signal has it (`TELEGRAM_BOT_TOKENS`), and the contract is
`@openbot/contracts/signal-protocol/telegram-route`.

- **Link.** A connection is one chat. The desktop asks `POST /v2/remote/hosts/<id>/telegram-link`
  (machine token) for a one-use code, and opens `t.me/<bot>?startgroup=<code>` or `?start=<code>`.
  Telegram sends `/start <code>` in the chat that adds the bot. Signal asks the Worker
  (`/v2/remote/telegram-route/link`, signed) to link the chat to the host of the code
  (`telegram_chat_routes`, `telegram_link_codes`: hashes only, no chat name), routes the chat to that
  host's socket at once, and passes the update on with `linked: true`; the host makes the
  connection only on that flag, because anyone in a routed chat can send a `/start` with any code.
  The open code holds the host's socket until the link or its expiry, as no connection may hold it. Another
  account's host gets `telegram_chat_taken`.
- **Updates.** Telegram posts to `https://signal.openbot.run/v1/telegram/updates/<bot ID>` with a
  secret header that Signal derives for each bot. Signal reads only the chat ID, a link code and a
  callback query ID, and sends `telegram-delivery` to the socket that holds the chat. It always
  answers 200: Telegram would hold back the bot's other chats behind one offline host. The Telegram
  route ticket (`telegramRoute` in the hello, audience `openbot-telegram-route`, the Slack route key)
  and `telegram-route-revoked` work as the Slack ones do.
- **Calls.** The host sends `telegram-call` only to a Signal whose `ready` names the `telegram`
  capability, because Signal closes a socket on a frame it does not know. Signal accepts only the
  methods and parameters of `TelegramCallParams`, as strict objects, only for a chat routed to that
  socket, and `answerCallbackQuery` only for a press it delivered to it. It returns only message IDs
  and tokens. `getFile` and `sendDocument` give signed one-use tokens for
  `GET /v1/telegram/files/<token>` and `POST /v1/telegram/uploads/<token>` (20 MB).
- **Conversations.** In a supergroup, each reply chain is one conversation: Telegram gives it a
  `message_thread_id`, the ID of its first message. A forum topic is one conversation, a direct chat
  is one, and a basic group finds the chain in an in-memory reply map, which a restart forgets. A
  mention starts or continues a conversation; a reply without a mention continues only a linked one.
  Telegram has no history API, so `TelegramChatState` keeps the names and last messages it saw, in
  memory. One Telegram Orchestrator (`telegram-orchestrator.ts`) answers every chat.

The code has two halves. `MessagingThreads` (`src/backend/messaging/`) is built by `AgentService`
beside `ChannelService` and knows no platform. `MessagingService` is built in the main process and
owns the live connections, through one `MessagingDriver` per platform: an adapter for its API and a
transport for its events. `messaging-types.ts` is the seam; the core never reads a platform payload.

- **Storage.** Migration 25 adds `projection_messaging_connections` (one per workspace, with its
  orchestrator agent) and `projection_messaging_threads` (one per external conversation, with the
  agent that answers it).
  Tokens are not in the database: `MessagingCredentialStore` keeps the bot token encrypted by
  `safeStorage`, keyed by connection, and only its state crosses IPC. Migration 36 adds
  `projection_messaging_memories`, the facts of each connection (`MessagingMemoryStore`, the same
  `MemoryStore` as agent and channel memories, with a connection for an owner). No code deletes a
  connection, so the table has no cascade: disconnect keeps the facts.
- **Orchestrator.** A message in a thread that has a link goes to the link's agent. A new conversation
  goes to the workspace's orchestrator; without one, Slack is told that no agent answers. The
  orchestrator is a normal agent (`slack-orchestrator.ts`): its description is its standing remit, and
  it starts with five memories, which are facts only, because the model reads memories as data. It
  gives work to one teammate with `send_message`; the request carries `messagingReturn`, so the
  teammate's answer runs as a follow-up turn in the same Slack thread. A turn that only asked a
  teammate posts "A teammate is working on it" (`MessagingThreads.awaitsTeammate`). It goes in the
  sidebar's Integrations section, which `MessagingService` creates the first time; the renderer shows
  that section collapsed. A disconnect deletes the orchestrator that no other connected place uses
  (`AgentService.deleteAgent`, which also removes its links), and then the section when no agent is
  assigned to it. It checks first that the agent can be deleted, so a busy orchestrator stops the
  disconnect before the token is revoked or the place unlinked.
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
  and the prompt, which frames the text as external input and adds earlier messages of the thread
  and the connection's facts, rebuilt each turn, so a new fact needs no provider-thread reload.
  `MessagingService.#receive` names each user mention (`InboundMessage.mentionedUserIds`) with the
  adapter's name cache; the adapters do the same for context messages.
- **Tools.** `messaging_remember`, `messaging_forget_memory` and `messaging_history` are deferred
  `openbot` tools. `OpenBotToolRouter` finds the link from the calling turn's execution thread and
  refuses a call from any other thread; no argument names a connection or a channel. The history
  tool calls the adapter's `recent` through `MessagingThreads.setHistorySource`. A fact is not saved
  from a direct message. The two outbound tools, `messaging_list_places` and `messaging_post`, are
  the exception: the router passes them to `MessagingThreads.outboundTool` from any thread, their
  arguments name an enabled connection and a place, and `MessagingService` answers them through
  `MessagingThreads.setOutbound` with the adapter's `places` and `postAnswer`, after `redactText`.
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
  covers a restart, and a kept event that Signal sends again. Events that arrive while no socket is
  open are lost after Slack's retries, except for a hosted server that starts.
- **Screen.** **Marketplace → Apps → Slack** on the computer that runs the agents shows
  each workspace and its orchestrator, and a two-step dialog connects the workspace and adds the
  orchestrator on the model the user picks (`messaging:*`). A remote server shows no Slack page,
  because the install returns to the host's own browser. A live connection does not count as use:
  a hosted server sleeps, and Signal starts it for the next message that addresses OpenBot and keeps
  that message, sealed to the host, until the host connects
  ([Connector events](../hosted-servers.md#connector-events)). **Apps → Discord** is the same page for Discord
  (`SlackIntegrationPanel` with `platform="discord"`). **Apps → Telegram** has its own page
  (`TelegramIntegrationPanel`), with one row per chat and one orchestrator for all chats.

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
