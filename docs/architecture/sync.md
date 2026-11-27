# Sync engine (`sync-v1`)

A joined-server client keeps a live copy of host data. The host sends only what changed for that
viewer. Writes still use the existing Team API routes. The host stays the source of truth; the
client copy is a view in memory. The client does not save the copy.

There are two kinds of sync data:

- A **collection** is a keyed set of rows, for example the channel list. The client sends the
  `[key, version]` pairs that it holds, and the host sends the difference.
- A **log** is an ordered list that can be long, for example the messages of a chat. The client
  holds a window of the newest rows and the older pages that it loaded. The host sends the changes
  after a cursor.

## Names

A name has a base and an optional parameter: `<base>` or `<base>:<param>`.

- The base is `<name>.v<N>`, for example `channels.v1` or `agent-messages.v1`. It matches
  `^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*$` and has at most 64 characters.
- The parameter selects one owner, for example an agent ID: `routines.v1:agent-1f…`. It matches
  `^[A-Za-z0-9_-]{1,128}$`.
- A base is either global (no parameter) or scoped (a parameter is necessary). A name of the wrong
  form gets `sync-unavailable`.

`parseSyncName` and `syncName` in `packages/contracts/src/team-protocol/sync-v1.ts` read and make
names. A change to the row shape of a released base is a new base (`<name>.v2`). The host serves
both bases while a client in the support window reads the old one.

## Wire

The messages go on the ordered `events` WebRTC channel, in the same `event-control` frames as
`agent-event-scope`. On a direct WebSocket they are plain JSON text messages. The codecs are in
`sync-v1.ts`. Each decoder ignores unknown fields. Each new field must be optional, so that an
older peer can decode the message. A change that an older peer cannot decode needs a new
capability (`sync-v2`).

### Collections

| Direction | Message | Use |
| --- | --- | --- |
| client → host | `sync-subscribe {collection, have, more}` | `have` is the list of `[key, version]` that the client holds. `more: true` on each chunk but the last. |
| client → host | `sync-unsubscribe {collection}` | Stop the pushes. Also for a log. |
| client → host | `sync-barrier {id}` | Ask for an answer after all pending changes. |
| host → client | `sync-changes {collection, upserts, deletes, synced}` | `synced: true` on the last chunk of a diff. |
| host → client | `sync-barrier {id}` | All changes before the barrier were sent. |
| host → client | `sync-unavailable {collection}` | The host does not serve this name to this viewer. Use HTTP. Also for a log. |

The version is the first 16 base64url characters of the SHA-256 of the row JSON. A client never
makes a version.

### Logs

| Direction | Message | Use |
| --- | --- | --- |
| client → host | `sync-log-subscribe {log, after, limit}` | `after` is the last cursor that the client got, or `null`. `limit` is the size of the first window. |
| client → host | `sync-log-older {log, id, before, limit}` | Ask for the page before the `before` cursor. |
| host → client | `sync-log-changes {log, rows, deletes, cursor, reset, olderCursor, synced, references?}` | With `reset: true` (on the first chunk) the client drops its rows and keeps these (the newest window). Without it, the client applies the rows and deletes. Each chunk has `cursor` and `olderCursor`. `synced: true` on the last chunk. |
| host → client | `sync-log-page {log, id, rows, olderCursor, done, references?}` | The answer to `sync-log-older`. `done: true` on the last chunk. `olderCursor: null` means no older rows. |

A log row is `{key, order, value}`. `order` is a string that the host makes; the client sorts by
`order`, then by `key`. A row can move: an update can change its `order`. The cursor is opaque to
the client. The host answers `reset` when it cannot resume from a cursor, for example after a
restore or when the cursor is too old. Streaming text is not in the log: it stays on the existing
delta events, and the full row comes through the log when it is written.

A change after the cursor that is older than the oldest row that the client holds is still sent.
The client keeps it only when it holds that key, so older loaded rows do not go stale.

`references` is an optional list of `{key, value}`: rows that a row of the message refers to but
that are not in the log window, for example the target of a quoted reply. The host sends them
before the rows. The client keeps them in a side map (`SyncLog.references()`), not in `rows()`.
A later row or delete with the same key changes or removes the entry, also when the row is older
than the window. A reset, `sync-unavailable` or a failure clears the map.

`SYNC_LIMITS` sets the bounds: 1,000 entries and 192 KiB in each chunk, 50,000 keys in a
collection, 200 rows in a log window or page, 128 characters in a key, 1,024 characters in a log
cursor (enough for the HTTP conversation page cursor).

## Host

`src/main/team-api/sync-hub.ts` (`SyncHub`) is generic. A host collection or log is registered by
its base.

```ts
interface SyncHostCollection<Viewer> {
  readonly name: string;
  readonly scoped: boolean;
  read(viewer: Viewer, param: string | null): MaybePromise<Iterable<readonly [string, unknown]> | null>;
  readKeys?(viewer: Viewer, param: string | null, keys: readonly string[]): MaybePromise<Iterable<readonly [string, unknown | null]> | null>;
}

interface SyncHostLog<Viewer> {
  readonly name: string;
  latest(viewer: Viewer, param: string, limit: number): MaybePromise<SyncLogPage | null>;
  since(viewer: Viewer, param: string, cursor: string): MaybePromise<SyncLogDiff | "reset" | null>;
  older(viewer: Viewer, param: string, before: string, limit: number): MaybePromise<SyncLogPage | null>;
}
```

`null` means that the viewer cannot read it: the hub sends `sync-unavailable`. A `readKeys` value
of `null` for a key means that the row is gone for this viewer.

1. On `sync-subscribe`, the hub reads the full view for the viewer and diffs it with `have`.
   Upserts are new or changed keys. Deletes are only keys in `have` that are not in the view, so a
   client never learns the key of a row that it cannot see.
2. `changed(name, keys?)` marks a collection. `name` can be a base (all parameters) or a full name.
   With `keys` and a `readKeys`, the hub reads only those keys. Otherwise it reads the full view.
   The hub reads in a microtask, once for each viewer key, diffs with the ledger, and pushes the
   difference. An empty diff sends nothing.
3. `changedLog(name)` marks a log. For each subscriber, the hub calls `since` with the cursor that
   it sent last and pushes the result.
4. Reads can be asynchronous. The hub runs the work of one connection in order, and a barrier
   answers only after the work that came before it.
5. A read error sends `sync-unavailable` and drops the ledger.

`TeamApiServer` calls `changed` and `flush` before it broadcasts a reload event, such as
`channels-changed`. Thus a client that reloads on that event reads a current copy. An agent, access
or hidden-agent change marks all collections and logs, because these change what a viewer sees.
The ledger is lost when the connection closes; the client subscribes again and gets the diff.

The host refuses a sync message from a connection that did not declare `sync-v1` (close 1003), and
a malformed message (close 1003).

## Client

`packages/team-client/src/sync-client.ts` (`createSyncClient`) owns the copy.

- `collection(spec, param?)` returns a handle: `status()`, `values()` (sorted by `spec.compare`),
  `get(key)`, `subscribe(listener)` and `mutate(...)`. Status is `idle`, `syncing`, `synced`,
  `stale` or `unavailable`.
- `log(spec, param, {limit})` returns a handle: `status()`, `rows()` (sorted by `order`, then key),
  `hasOlder()`, `loadOlder(limit)`, `subscribe(listener)` and `mutate(...)`.
- `release(name)` unsubscribes from one name and frees its handle.
- `resubscribe()` subscribes each handle again: a collection sends `have`, a log sends `after`.
  Call it when the connection is online, and after an event reset.
- `pause()` sets each live handle to `stale` when the connection goes offline. The rows stay.
- `mutate({key, apply, run})` shows `apply` at once as an overlay, runs the write, waits for a
  barrier, then removes the overlay. If `run` fails, the overlay goes and the old row comes back.
  The barrier makes sure that the confirmed row is in the copy before the overlay goes, so the row
  does not flash back to the old value.
- The desktop and web clients do not call `mutate`. Their optimistic overlays stay in the renderer
  (`src/renderer/src/queue-optimistic.ts`, `src/renderer/src/features/crm/crm-optimistic.ts`,
  and the reaction and read-state overlays), because one overlay serves this computer, a joined
  server and the web client. Use `mutate` only in a client that owns its overlay.
- A row that does not decode, or a key that does not match its row, sets the handle to
  `unavailable` and unsubscribes. The caller then uses HTTP.

## Collections and logs

| Name | Kind | Key | Row | Capability | Host reload event |
| --- | --- | --- | --- | --- | --- |
| `channels.v1` | collection | channel ID | `ChannelSummary`, an item of `GET /v1/channels` | `channel-chats-v1` | `channels-changed` |
| `agents.v1` | collection | agent ID | `ClientAgentSummary`, an item of `GET /v1/agents` | none | `agents-changed` |
| `hidden-agents.v1` | collection | `snapshot` | `HiddenAgentsSnapshot`, the body of `POST /v1/hidden-agents` | `agent-hidden-v1` | `hidden-agents-changed` |
| `sidebar-pins.v1` | collection | `snapshot` | `SidebarPinsSnapshot`, the body of `POST /v1/sidebar-pins` | `sidebar-pins-v1` | `sidebar-pins-changed` |
| `sidebar-layout.v1` | collection | `snapshot` | `SidebarLayoutSnapshot`: the body of `POST /v1/sidebar-folders` with `sidebar-folders-v1`, else of `GET /v1/sidebar-layout` | none | `sidebar-folders-changed` or `sidebar-layout-changed` |
| `notification-levels.v1` | collection | `snapshot` | `AgentNotificationLevelsSnapshot`, the body of `POST /v1/agent-notification-levels` | `agent-notification-levels-v1` | `agent-notification-levels-changed` |
| `conversation-reads.v1` | collection | agent ID | `ConversationReadEntry`: a value of `GET /v1/agents/conversation-reads` with its key as `agentId` | none | `conversation-invalidated`, `conversation` |
| `routines.v1:<agentId>` | collection | routine ID | `Routine`, an item of `GET /v1/agents/<id>/routines` | none | `routines-changed` |
| `workflows.v1` | collection | workflow ID | `WorkflowSummary`, an item of `workflows` in `POST /v1/workflows/list` | `workflows-v1` | `workflows-changed` |
| `crm-customers.v1` | collection | customer ID | `CrmCustomer`, an item of `customers` in `POST /v1/crm/customers` (all pages) | `crm-v1` and an owner or admin | `crm-changed` |
| `queue.v1:<agentId>` | collection | `snapshot` | `QueueSnapshot`, the body of `GET /v1/agents/<id>/queue` | none | `queue-changed` |
| `agent-messages.v1:<agentId>` | log | message ID | `ConversationMessage`, an item of `messages` in `GET /v1/agents/<id>/conversation-page` | none | `conversation`, `conversation-invalidated`, `turn-completed` |
| `channel-messages.v1:<channelId>` | log | message ID | `ChannelMessage`, an item of `messages` in `POST /v1/channels/read` | `channel-chats-v1` | `channels-changed` |
| `conversation-meta.v1:<agentId>` | collection | `snapshot` | `ConversationPageMeta`: the fields of the latest `GET /v1/agents/<id>/conversation-page` that are not messages | none | `conversation`, `conversation-invalidated`, `turn-started`, `turn-completed`, `queue-changed` |
| `channel-meta.v1:<channelId>` | collection | `snapshot` | `ChannelPageMeta`: the body of `POST /v1/channels/read` without `messages` | `channel-chats-v1` | `channels-changed` (marks all channel metas) |

The specs, with the released row decoders, are in
`packages/contracts/src/team-protocol/sync-collections.ts` and, for the logs,
`packages/contracts/src/team-protocol/sync-logs.ts`. The host readers are in
`src/main/team-api/sync-collections.ts` and `src/main/team-api/sync-logs.ts`. Each reader applies
the same visibility as its HTTP route and shares the function with it:

- `visibleConversationReads` (`route-agents.ts`) removes each agent that the viewer cannot see,
  for `GET /v1/agents/conversation-reads` and for `conversation-reads.v1`.
- `isReleasedRoutine` (`route-agent-routines.ts`), `queueResponse` (`route-agent-queue.ts`),
  `visibleWorkflowSummaries` (`workflow-visibility.ts`), `crmCustomerPage` (`route-crm.ts`),
  `visibleSnapshot` (`route-agent-hidden.ts`) and `visiblePeerChannels` (`route-channels.ts`).
- A scoped reader (`routines.v1`, `queue.v1`) returns `null` for an agent that the viewer cannot
  see or that does not exist. Thus an access change ends the subscription with `sync-unavailable`.

A row is the exact per-item JSON of the HTTP route. The reader encodes the value with
`#encodeBody`, the encoder of the HTTP responses, with the viewer's protocol, capabilities and
hidden agents. The viewer protocol comes from the event capabilities (`eventProtocol`). Thus a
client must declare on the event socket (`agent-event-scope`) the same capabilities as on its
HTTP calls. With protocol 10 that is the expanded list (`expandTeamCapabilitiesV10`), not the
short header list. When the lists differ, a row can differ from the HTTP body.

A row keeps the wire key names of the HTTP body, for example `botId` in a routine. The client
HTTP adapter changes them to the current names (`toCurrentAgentKeys`) before it decodes. The sync
client decodes the row without the adapter, so each spec decoder does the same change first
(`wireDecoder`). `sidebar-layout.v1` and `conversation-reads.v1` do not change keys, because their
HTTP paths are not changed (`isUntranslatedPath`). `channels.v1` keeps its released decoder.
The log specs (`agent-messages.v1`, `channel-messages.v1`) also use `wireDecoder`, because a
message row can have `senderBotId` or a reaction actor `{kind: "bot", botId}`. The desktop
rebuilds a conversation page from the log and the meta row with current names. It changes them back
to the wire names (`wireSyncBody`) before it sends the page through the HTTP decoder.

A `snapshot` row holds the full HTTP body. The client rebuilds the response from the one row.
For `queue.v1` this keeps `QueueSnapshot` as it is, with its delivery order and the window that
`queueResponse` makes.

The order of `agents.v1` and `conversation-reads.v1` is not in the row, so these specs have no
`compare`. Read them by key. The other list specs sort as the HTTP route: channels by `createdAt`,
routines and workflows newest `updatedAt` first, CRM customers by `number`.

The workflow and CRM readers are asynchronous (Effect services). Their push can arrive after the
reload event. The other readers are synchronous, so their push arrives first.

### Message logs

The message logs use the change sequence of the host database (migration
`0071-sync-change-sequence`). The table `sync_message_changes` has one row for each message that
changed: `scope` (`thread` or `channel`), `owner_id` (the thread or channel ID), `message_id`,
`deleted`, and an `AUTOINCREMENT` `sequence`. Triggers on `projection_thread_messages` and
`projection_channel_messages` replace that row on each insert, update and delete. An update that
does not change a shown column (for example only `last_event_sequence`) records nothing. A
delete of a thread or a channel deletes its change rows. The migration does not fill the table:
the first window of each client is a `latest` read.

The cursor is `<sequence>.<tag>`. The tag is 12 hex characters of the SHA-256 of the viewer key
(`teamSyncViewerKey`), the scope and the owner. Thus a cursor of another viewer, another thread or
another channel gets `reset`. `since` also answers `reset` for a cursor that does not parse, a
sequence after the last change, or more than 1,000 changes after the cursor.

- `latest` reads the last change, then the HTTP page (the same function as the route), so a write
  during the read comes again through `since`. The agent window is at most 100 messages (the HTTP
  page limit); the channel window is the channel page (100).
- `older` takes the HTTP older cursor: the conversation page cursor for an agent, the
  `beforeSequence` for a channel. The last page has `olderCursor: null`.
- `since` reads the changed rows after the cursor with the same marker filter as the HTTP page.
  A changed row that the viewer cannot see is a delete.
- A thread row `order` is the shown order of the HTTP page: `group_start`, `group_first`,
  `group_id`, `turn_rank`, `created_at` and `ordinal`, each padded to a fixed width. A message
  that comes in the middle of a turn sorts inside the turn. A write can change the group columns
  of other messages of the same turn; these rows also come through `since`. A channel row `order`
  is its `sequence`.
- The readers apply the same visibility as HTTP. An agent log is `null` for a hidden or unknown
  agent. A channel log is `null` without `channel-chats-v1`, for an unknown channel, or for a
  channel that the viewer cannot see (`channelVisible`).

`TeamApiServer` calls `changedLog` (`#signalSyncLog`) for a message write, an edit, a reaction, a
delete and the end of a stream, not for each streaming delta.

### Page meta and references

A client rebuilds the HTTP page from a log, its meta collection and the log references, with the
pure helpers in `packages/team-client/src/sync-pages.ts`:

- `conversationPageFromSync(rows, meta, references, {olderCursor, newerCount})` gives the
  `ConversationPage` of `GET /v1/agents/<id>/conversation-page` after the client HTTP adapter
  (`botId` becomes `agentId`). For the latest page, pass all rows of the handle and the handle
  `olderCursor()`. The page equals the HTTP page with `limit` equal to the number of rows, because
  the window starts at a turn boundary. For an older page, pass the rows of that page and
  `newerCount`, the number of rows after it.
- `channelPageFromSync(rows, meta, {olderCursor})` gives the latest `ChannelPage` of
  `POST /v1/channels/read`. It keeps the rows from `meta.olderCursor`.
- Each helper returns `null` while the meta and the log do not agree (the two arrive in separate
  messages). Show the last page and wait for the next change.

`ConversationPageMeta` has `agentId`, `threadId`, `activeTurnId`, `revision`, `readState` (for the
viewer), `messageCount`, `oldestAt` and `historyExtent`. The helper makes `pageInfo` from them:
`olderCount` is `messageCount` minus the rows of the page and the newer rows, and `olderCount`
and `oldestAt` are in `pageInfo` only with `history-extent-v1`, as in HTTP. `olderCursor` comes
from the log. The meta does not hold `references` or `olderCursor`, so a new message does not
change it. `ChannelPageMeta` is the channel page without messages: `channel`, `tasks`,
`olderCursor`, `throughSequence`, `olderCount`, `oldestAt` and `waits`.

References go through the log, not through the meta. The `latest` and `older` reads send the
`references` of the HTTP page. `since` sends the targets of `replyToMessageId` that are not in
the same batch, read with the same marker filter. The helper takes from the side map each target
that is not in the page rows. Thus the client shows each quoted message, also for older pages.

Limits:

- The host reads the meta with the same function as HTTP (`readConversationPageFor` with limit 1),
  so each read also runs the mailbox reconcile.
- The channel meta marks all channel metas on `channels-changed`, because `waits` depends on the
  tasks of other channels. It also marks them on `usage-limit-reached`, `runtime-snapshot` (a usage
  limit ends) and `host-turn-limits-changed`, because `waits` depends on the usage limit and the
  channel turn limit of each agent.
- HTTP halves a page or cuts long text to fit one WebRTC frame. Sync does not. The rebuilt page
  equals the HTTP page only when the HTTP page fits.
- `since` does not refresh the queue positions of queued messages (`refreshQueuePositions`).
- When the HTTP cursor is longer than 1,024 characters, the log uses its own older cursor.
- Older channel pages are not rebuilt: use the log rows.

## Clients

| Client | Owner of the sync client | Exposure |
| --- | --- | --- |
| Web client | `src/renderer/src/features/web-client/web-runtime.ts` | The runtime reads a handle when it is `synced`, and uses HTTP for each other status. |
| Desktop with a joined server | `src/main/remote-server-sync.ts`, one per server, next to `RemoteServerManager` | The `remote` branch of each IPC read returns the synced copy. The event `agent:sync-changed {serverId, name}` tells the renderer to read again. |
| Mobile | `apps/mobile/src/features/workspace/sync/`, one per server in `MobileWorkspaceProvider` | The stores read a handle when it is `synced`. The encrypted workspace cache shows the old copy until the handle is `synced`. |
| Browser extension | `apps/browser-extension/src/workspace.ts`, one per open server | The side panel reads a handle when it is `synced`, and uses HTTP for each other status. The X agent lookup uses the synced agents. |

The web client and the browser extension share `createClientSync`
(`packages/team-client/src/client-sync.ts`). It opens the collections and logs, turns each change
into the released agent event, and counts the writes that the next read must wait for. It keeps one
agent scope and one channel scope. The web client moves the channel scope only when the user
selects a channel. A prefetch of another channel page does not move it.

The web client and the browser extension always deliver a reload signal that a synced handle
makes. They drop a released host reload event only when the same signal came from sync in the last
2 seconds. A host event can come before the sync change, and then the read returns the old copy, so
the later sync signal must not be dropped.

### Desktop with a joined server

- Each desktop spec has the same `name` as the shared spec. Its decoder sends the row through the
  desktop HTTP pipeline: `decodeRemoteResponseBody` with the HTTP method and path, then
  `addRemoteWireExtensions`, then the decoder of the IPC read. Thus the synced value is the same as
  the HTTP value.
- A global collection opens when the server is online and the host has the capability that its
  route needs. A change of these capabilities opens the collections again.
- A scoped collection (`routines.v1`, `queue.v1`) opens on the first IPC read for the agent. That
  read uses HTTP. Each server keeps at most `REMOTE_SYNC_SCOPES_PER_SERVER` (8) scopes per
  collection open, and releases the scope that was read least recently. A scope is also released
  when its agent leaves the synced `agents.v1` list.
- The desktop keeps the order of the HTTP route. `agents.v1` keeps the host order of the first
  copy and puts new agents in front. `channels.v1` keeps the host order. Routines, workflows and
  CRM customers use the sort order of the spec. CRM pages use the same page size and `next` as the
  host store.
- For `queue.v1`, the main process also sends the released `queue-changed` agent event, and the
  event refresh does not read the queue over HTTP while the scope is synced.
- The released reload events stay. Thus the renderer can read twice for one change.
- The workflow controller does not read a workflow again for the event of its own save. It puts the
  saved revision, graph and summary into the open workflow in one write. The canvas then uses the
  saved graph as its merge base. In Solid 2, a second write in the same batch reads the old value,
  so two writes put the old graph back, and two people who edit the same note do not agree.
- An IPC read of the latest conversation page opens `agent-messages.v1` (limit 50) and
  `conversation-meta.v1` of the agent. An IPC read of the latest channel page opens
  `channel-messages.v1` (limit 100) and `channel-meta.v1` of the channel. The two handles are one
  scope, with the same limit and release rules as a scoped collection. A channel scope is released
  when its channel leaves `channels.v1`.
- When both handles are `synced`, the read returns the page that `conversationPageFromSync` or
  `channelPageFromSync` rebuilt, sent through the desktop HTTP pipeline. When the helper returns
  `null`, the read returns the last rebuilt page. Without a rebuilt page, the read uses HTTP. A
  conversation read with a limit less than 50 (the read state check) and all older pages use HTTP.
- The rebuilt conversation page holds all rows of the log. When new messages arrive, it can hold
  more rows than the limit of the read. It is the same as the HTTP page with a limit of that number
  of rows.
- A new rebuilt conversation page goes to the renderer as the released `conversation-page` agent
  event, and the event refresh does not read the conversation over HTTP while the scope has a
  rebuilt page. A rebuilt channel page sends `agent:sync-changed` with the log or meta name; the
  renderer then reads the channel again, as on `channels-changed`.

### Mobile

- After a reconnect without `resync`, the client reads `GET /v1/compatibility` again before it
  sends a sync message. An update-required answer, an error or safe mode keeps sync paused.
- A read waits for a barrier only after a local write (a request that is not `GET`). Another read
  uses the synced copy at once.
- A chat screen holds `agent-messages.v1` (limit 50) and `conversation-meta.v1` of its agent. A
  channel screen holds `channel-messages.v1` (limit 100) and `channel-meta.v1`. The latest-page
  read uses the rebuilt page, cut to the mobile HTTP page shape. When the helper returns `null`,
  the read uses HTTP and a change does not refresh. Older pages and streaming deltas stay on HTTP
  and events.
- `agents.v1` sorts by the `agentOrder` of the sidebar layout first. Then it keeps the previous
  order and puts new agents in front.

## Add a collection or a log

1. Add a spec to `packages/contracts/src/team-protocol/sync-collections.ts`: the base name with a
   version suffix, the key, the decoder of the released row type, and a sort order when the host
   order is not in the row.
2. Add the host reader. `read(viewer)` must apply the same visibility as the HTTP route; share the
   function. Return `null` when the viewer does not have the capability that the route needs.
   Encode the value with `sources.response(...)` and the HTTP method and path, so that the row is
   the HTTP JSON. The per-flush cache key (`teamSyncViewerKey`) has the member, the role, the
   protocol, all capabilities and the hidden agents, so viewers do not mix.
3. Call `changed(name)` or `changedLog(name)` where the data changes. When a broadcast event tells
   clients to reload, call `flush()` before the broadcast.
4. In each client, read the handle when its status is `synced` and use HTTP for each other status.
   Keep the HTTP path while a host in the support window does not serve the name.
5. Add the steps to `scripts/sync-e2e.ts`, or to `scripts/sync-log-e2e.ts` for a log.

## Compatibility

`sync-v1` is an optional protocol 10 capability. A client sends sync messages only when the host
advertises `sync-v1`. Hosts and clients without it keep the HTTP reads and the reload events.
Removing those paths needs the 60-day support window.

## Check

CI runs `test:sync`, `test:sync-log` and `test:remote-sync` (the desktop with a joined server) in
the Team API routes E2E job when desktop code changes. `test:web-sync` and `test:extension-sync`
need a dev stack and run only by hand. `test:team-webrtc-wire-parity` decodes each sync message as a
WebRTC frame: the client messages in `event-control` frames, and the host messages in `event`
frames.

`bun run test:sync` (`scripts/sync-e2e.ts`) starts a host and checks the subscribe diff, the push
before each reload event, an update, a visibility change, the barrier, a reconnect with `have` and
with a log cursor, older log pages, the team-client store with `mutate`, `sync-unavailable`, and
the refusals. The report is `.openbot-build/sync/report.json`.

For each collection, the check also compares the subscribe rows with the HTTP route, pushes a
change through a Team API route, and sends a change that must reach only the right viewer or scope.
It checks that `GET /v1/agents/conversation-reads` and `conversation-reads.v1` do not show an agent
that the member cannot see, that an access change deletes the agent and read rows and ends the
scoped subscriptions, and that a client without `sync-v1` keeps each reload event and HTTP read.
The HTTP calls send protocol 10 capability lists with the absent list, so that the host uses the
same capabilities as the event socket.

`bun run test:sync-log` (`scripts/sync-log-e2e.ts`) starts a host and checks the message logs
against the HTTP routes: the latest window and each older page (the last page has
`olderCursor: null`), a new message, an edit, a reaction and a delete through `since`, a message
inserted in the middle of a turn, a reconnect with `after` that gets only the diff, a reset for an
unknown cursor, a cursor of another viewer and more than 1,000 changes, `sync-unavailable` for a
hidden or unknown agent and a channel that the member cannot see, and `createSyncClient().log`
with `loadOlder` and a change to a loaded older row. It also rebuilds the latest agent and channel
pages from the logs, the meta collections and the references, and compares them with the HTTP
pages: at first, after a new message, a reaction, a turn start and end, a read mark and a quoted
reply to a message outside the window, and for an older agent page with its references. The
report is `.openbot-build/sync/log-report.json`.
