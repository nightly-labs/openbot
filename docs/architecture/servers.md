# Servers, storage, and billing

## Storage and files

Three surfaces show what a host keeps on disk: Server Settings > Storage (scope `host`), Agent
settings > Files (scope `agent`) and the chat Files panel (scope `conversation`). They share
`src/renderer/src/features/files/storage-usage.ts`, which names the server explicitly, because Server
Settings can be open for a server that is not the selected one.

`src/backend/storage-usage.ts` owns the scan and has no Electron imports. Sent and generated files
come from the mailbox state in memory, with their chat from paged read-only queries in
`database/storage-usage-queries.ts`; a file's status comes from `lstat`, not from
`resolveAttachment`, which hashes the file. Workspaces, shared files, downloads, caches, logs and
runtimes are measured by a bounded walk: `lstat`, no symlinks followed, a stop at 100,000 entries,
and a yield between pages, because `DatabaseSync` and the walk run on the main thread. A result is
cached for 60 seconds per scope, a scan in progress is shared, and a delete, clear or agent delete
drops the cache. Lists stop at `STORAGE_LIMITS` and set `truncated`; the breakdown still counts
every byte.

A delete does not change the schema. `MailboxStore.deleteStoredFile` sets `deletedAt` on the stored
attachment, persists, and queues the file path, not the transfer folder, in the file-deletion outbox.
It keeps a path that another live record uses, and it deletes only a real path under the Transfers
folder. `resolveAttachment` then returns null, so a file card shows "File not found" and a generated image
shows its unavailable state. An older app ignores the field. Clear removes the remote-server caches and the `logs/remote`,
`logs/update`, `logs/providers`, `logs/agents` and `logs/main` files; it does not enter `logs/remote/transfers`. Runtimes are read-only.

`storage:*` IPC reaches the local service or a joined server. The optional `storage-v1` capability
exposes `POST /v1/storage/usage`, `/v1/storage/delete-file` and `/v1/storage/clear` with the frozen
codec in `team-protocol/storage-v1.ts`. The host advertises it only when its storage service
exists. Every member reads usage; delete and clear need an owner or admin (`requireAdmin`), and the
renderer hides those controls from a member. The wire carries no absolute paths, and workspace and
download files travel only as category totals. A host without the capability reads as null, and the
surface asks for an update; a change is refused before any request.

The optional `storage-disk-v1` capability adds `POST /v1/storage/disk` (`team-protocol/storage-disk-v1.ts`).
It answers the free and total bytes of the disk that holds the host data, from one `statfs` call
with no scan, so it is a passive route. Every member can read it. The sidebar storage card
(`features/sidebar/storage-card.ts`) reads it for an owner or admin of the selected server, at
start, every five minutes, and when Server settings closes. Under 10% free (at most 5 GB) the card
says "Storage almost full" and can be closed until the next level; under 2% free (at most 1 GB) it
is red and cannot be closed. "Free up space" opens Server settings › Storage. A host without the
capability shows no card.

The optional `machine-resources-v1` capability (`team-protocol/machine-resources-v1.ts`) adds the
machine part at the top of Server settings › Storage, for an owner or admin only. `POST
/v1/admin/host/machine/metrics` answers the disk, memory and CPU use of the machine that runs the
host (`src/main/machine-metrics.ts`), as the server can use it. The disk is the one that holds the
data folder, counted as `df` counts it: space that ext4 keeps for root is neither used nor free. In
a Docker container that is the disk of the Docker host, which all its containers share; Docker sets
no disk limit per container. Memory counts what programs can still use: `MemAvailable` and the
cgroup limit on Linux, Activity Monitor's "Memory Used" from `vm_stat` on macOS, and free memory on
Windows. CPU is the use since the reading before. When main's cgroup has a CPU limit (`cpu.max`,
such as `docker run --cpus`), it is the cgroup's `usage_usec` against that limit, and the core count
is the limit; otherwise it is the use of all cores of the machine. The panel reads it each minute
while it is open; the read routes are passive. `.../machine/alerts` and `.../alerts/update` read and
set one level per metric (50–99%) and the owner or admin who gets the alert, in
`openbot-machine-alerts-v1.json` (`src/main/machine-alerts.ts`). With no member set, or when that
member is no longer an admin, the owner gets it. The host checks the machine once a minute. A metric
at or above its level alerts once, and again each day while it stays there; CPU must stay above for
five readings. The alert ends when the use goes 5 points below the level. The host sends the
`machine-alert` event only to the event sockets of that member, and again to each device of theirs
that connects while the alert is in force; the desktop shows each alert id once, as a notification.
When the host is a desktop app and its owner gets the alert, that app shows it directly. For an
owner or admin of the selected server, the sidebar machine card (`features/sidebar/machine-card.ts`)
reads the use and the levels at start, every five minutes, and when Server settings closes. It shows
the metric furthest above its level in place of the storage card, which then does not show; far
above the level (95%, or 10 points above a higher level) it is red and cannot be closed. A closed card
stays closed for that metric and level until the use goes below every level.

### Hosted sites per server

A hosted site belongs to the server that published it (`hosted_sites.server_id`, D1 `0024`). The user
stays the accountable owner, for abuse reports, blocks and account deletion. The desktop sends
`OpenBot-Host-Id` and `OpenBot-Host-Token` (the machine token of `/v2/remote/hosts/register`) on each
`/v1/sites` request when it is a registered server. The Worker checks the hash and that the host owner
is the request user; a wrong token is refused with 401, never counted as unlinked. The active-site
limit comes from the server's plan (`siteLimitForPlan`: none 1, Starter 3, Standard 10, Pro 50). A
request with no server headers creates only into the account's unlinked bucket (limit 1,
`server_id IS NULL`); with no `?scope=unlinked`, it still lists and deletes every site of the account,
the released meaning of `/v1/sites`. Replace and delete in a server scope refuse a site of another
bucket with 409 `site_other_server`. A downgrade deletes nothing: a server above its limit cannot
create a site, but it can replace one, and the extra sites end at their expiry. Removing a server moves its sites to the owner's unlinked bucket, so the owner's desktop can still delete them. A registered server updates a site that it published before registration in the unlinked scope.

`hostedSites.list` and `hostedSites.delete` IPC are server-scoped; publish and replace stay local. The
optional `hosted-sites-v1` capability exposes `POST /v1/hosted-sites/list` for every member and
`POST /v1/hosted-sites/delete` for an owner or admin, with the frozen codec in
`team-protocol/hosted-sites-v1.ts`. The host answers with its own account and credential, and only with the server's own sites: the owner's unlinked sites never reach a member, and the Team API has no fallback to delete one. Sites are
managed in Server settings > Sites, on the desktop and in the browser.

### Leaving a server

Leaving a joined server has the same effect as an admin removal: the membership and every session of
it end, on all of the member's devices. On WebRTC, the account service revokes the membership, as it
does for the owner's removal. On HTTP, `member-leave-v1` adds a bodyless `POST /v1/team/leave`, which
runs the steps of the admin `DELETE /v1/team/members/:id` for the caller; the owner is refused. A host
without the capability answers 404, so the client only logs out: that token stops working, and the
membership stays for an admin to remove. Either way the client removes the server, also when the host
does not answer.

### New chat

`context-reset-v1` adds `POST /v1/agent-context/clear` with `{ agentId }`. Any member who can see the
agent can send it. The host writes a system message with `itemType: "context-reset"` to the agent's own
thread and ends that thread's provider sessions. The thread, its messages and the agent do not change.
The next provider session gets a handoff of only the messages after the last marker. The host refuses
the request while a turn runs or a message waits in the queue. A client without the capability shows
the marker as its text. Channel execution threads are not reset.

### Workspace folders

`workspace-directory-v1` adds `POST /v1/workspace-directory` with `{ agentId, path }`. Any member who
can see the agent can send it, as with `GET /v1/workspace-files`. The host answers the folder entries
(name, path, kind, size, modification time), at most 500, directories first. The path must stay inside
the agent workspace; a symbolic link that leaves it is not listed. A missing path answers 404 with a
message that names the path and the workspace. A client without the capability shows the file preview
error. The desktop lists a local folder without the containment when the agent has no workspace limit.

### Conversation files

`conversation-file-search-v1` adds `POST /v1/conversation-files/search` with `{ query, cursor, limit? }`.
Any member can send it. The host answers the files of agent chat messages whose name contains the
query, newest first, with the agent, the message, the time and the attachment summary. An empty query
lists the newest files. A page has at most 100 results (50 when `limit` is absent), and `nextCursor`
gets the next page. Channel threads and the files of an agent hidden from the client are not listed.
The capability is advertised only to protocol 7 clients. An older host answers 404, so a client
sends the request only when the host advertises the capability.

### Side questions

`side-question-v1` adds `POST /v1/side-questions/ask` with `{ agentId, question, earlier }` and answers
`{ answer }`. Any member who can see the agent can send it. The host answers with the agent's provider
and model, from the agent's profile and the end of its chat, with no tools. The question and the
answer do not go into the chat, and the host keeps nothing, so `earlier` carries at most 20 earlier
questions and answers of the side question. An earlier answer has at most 32,000 characters. A
failed generation, such as a busy provider or a usage limit, answers 409 with a sentence for the
member. The capability is advertised only to protocol 7
clients. The desktop on a joined server and the web client show the side question only when the host
advertises it.

### Agent import from a joined server

`agent-import-v1` lets any member, not only an owner or admin, import a Grok Bot export into the host.
`POST /v1/agent-import/stage` takes the raw `.zip` (at most 100 MB) and answers the preview without
avatars, so the preview stays under the 2 MB WebRTC frame limit. `AgentImportService.stageUpload` writes
the file to `agent-import-uploads/` in the host's user data and keeps it under a token that only the
caller's member id can apply or discard. One member keeps one export, the host keeps four uploads at
most, and an upload nobody applies is released after 30 minutes; the folder is cleared on the first
upload after a restart. `POST /v1/agent-import/apply` takes `{ token, keys, channelKeys, timezone }` and
answers the new agents by id and name, which the client reads with the agent list. Channels are created
with the member as the actor. A member never revises a skill already in the host library: the agent
gets the existing skill and the result warns. `POST /v1/agent-import/discard` releases the token. On
desktop, main opens the dialog, reads the file and sends it (`agent-import:choose` is server-scoped);
the web client uses the browser chooser and ships the export skill in its bundle.

### Instance transfer with a joined server

`instance-transfer-v1` moves a server's agents and server settings to or from an OpenBot transfer file
(see [Instance transfer](agents.md#instance-transfer)). Only an owner or admin can use it: the file holds
every agent's memories and files, and an import adds server settings. It is protocol 7 only. Every file
that crosses the connection is at most 100 MB, the size of one WebRTC file transfer; a computer's own
server keeps the 2 GB limit. `POST /v1/instance-transfer/summary` lists the agents with their counts and
no avatar address. `POST /v1/instance-transfer/export` takes `{ agentIds, includeFiles, includeSettings }`,
writes the file to `instance-transfer-uploads/` in the host's user data, sends it as an attachment and
removes it. `POST /v1/instance-transfer/stage` takes the raw `.zip` and answers the preview without
avatars, under a token that only the caller can apply or discard; an upload nobody applies is removed
after 30 minutes. `POST /v1/instance-transfer/apply` takes `{ token, keys, includeSettings, timezone }`
and answers the new agents by id and name, which the client reads with the agent list.
`POST /v1/instance-transfer/discard` releases the token. On desktop, main opens both dialogs and moves
the file (`instance-transfer:*` is server-scoped). The web client does not show the Transfer section: its
downloads are limited to 10 MB.

After a restart, the first upload or export removes old files from `instance-transfer-uploads/`,
including unfinished `.part` files, before it writes a new file. Concurrent uploads and exports wait
for this cleanup. If cleanup fails, the operation fails; the next upload or export retries it.
Later operations keep the current process's files. Local files selected by the user are kept.

### Routine flows

`routine-flows-v1` serves the routine canvas (see [Routine flows](agents.md#routine-flows)) to a
joined desktop and to the web client. Its routes are `POST /v1/routine-flows/canvas`,
`/positions/save`, `/positions/remove`, `/links/connect`, `/links/disconnect` and `/links/update`,
with the input in the body. Any member who can see the agents can read and change a canvas, as with
the agent routine routes; it is not an admin capability. A member sees a routine only when every
agent it touches is visible, and the host answers a hidden or unknown agent, routine or link with
404. A webhook trigger's URL goes only to an owner or admin; a member reads it as null. Step input,
output and error cross with at most 4,000 characters each, and the host empties the step texts of the
routines with the oldest runs first when a canvas would pass three quarters of one WebRTC frame. The
optional event `routine-flows-changed { agentId }` names the canvas that changed; the host sends it
only to a connection with the capability and never for a hidden agent. Webhook config, secret
rotation and webhook test runs stay on `events-v1`. A client without the capability shows a notice
in the Routines view; the web client shows the view switch only when the host serves it.

### Workflows

`workflows-v1` serves the workflow canvas (see [Workflows](agents.md#workflows)) to a joined desktop,
to the web client and to the mobile app. Its routes are `POST /v1/workflows/<name>` with the input in the body:
`list`, `get`, `create`, `rename`, `delete`, `save-graph`, `versions`, `version-graph`,
`restore-version`, `start-run`, `run-step`, `stop-step`, `stop-run`, `retry-step`, `decide`, `runs`,
`run` and `rotate-webhook-secret`. `version-graph` gives the graph of one version for the preview,
with the same filter as `get`. The contract header in `team-protocol/workflows-v1.ts` records the grant:

- A member sees a workflow only when every agent of its agent steps is visible and no model step
  names a provider that the member's protocol hides (also for the owner on a remote client). An owner or admin also sees a workflow that names a
  deleted agent, so they can fix or delete it. The host answers any other workflow, and its runs,
  steps and versions, with 404.
- A run, a single step, a stop, a retry or a decision needs the chat level for each named agent. A
  retry, a stop and a decision check the agents of the current graph and of the run's graph.
- A change, a rename, a delete, a restore or a new webhook secret needs the manage level for each
  named agent, before and after the change (403). A restore checks the graph of the version. The
  desktop shows the canvas read-only when the member does not manage each agent of the graph.
- A workflow that names no agent, such as one with only model and condition steps, needs no agent
  level. Each member who sees it can change and run it on the host's providers. This is a product
  decision: model and condition steps are open to each member who can see the workflow.
- Only an owner or admin can add an output that posts to a messaging place, or change its place
  (403 `adminRequired`); a member can keep and run one that is there.
- A step of an agent that is hidden now does not cross: the generic hidden-agent filter of the
  answer drops it.
- A webhook trigger's URL goes only to an owner or admin; a member reads it as null. Only an owner
  or admin can make a new secret.
- Step output and error cross with at most 32,000 characters each, and a run sends its newest
  2,000 steps. When a page of runs would not fit one WebRTC frame, the host empties the step texts
  of the oldest runs first, then answers 413 `tooLargeToSend`.

Node kinds, port types, statuses, run sources, trigger types and version kinds cross as open names,
so a newer host can add one. A client shows a workflow with a node kind or a port type that it does
not know as read-only (`needsNewerApp`), and keeps the node when it saves.

The optional event `workflows-changed { workflowId }` names the workflow that changed, so the
client reads it again. A client without the capability shows `serverTooOld` on the Workflows page.

The desktop app and the mobile app decode the answers with the same module,
`packages/team-client/src/workflow-decoding.ts`. The host sends `workflows-changed` for each run
and step change, so the mobile list, run and drawer read again on the event and do not poll.

The mobile app edits a workflow as a list of steps, not as a canvas
(`apps/mobile/src/features/workflows/model/workflow-outline.ts`). A graph with one trigger, at most
one condition, and one path in and out of each step, except the step where the two condition paths
join, becomes an outline. A change to the outline writes the edges of its steps again, with the
edge ids of the desktop canvas. A new step goes to the right of the step before it, and the steps
after it move right by its width. Other nodes, the notes, the shapes and the drawings keep their
places. Any other graph keeps its edges: the phone changes only the settings of its steps. A save
that a newer revision refused shows the conflict, and the person keeps the draft or loads the saved
workflow. The pins of the mobile drawer stay on the phone, in the workspace preferences of the
account and server (`pinnedWorkflows`); the host does not know them.

### History extent

`history-extent-v1` lets the chat's scroll rail draw the history that is not loaded on a joined server.
It adds `olderCount` and `oldestAt` (at most 64 characters) beside the frozen keys of `pageInfo` on
`GET /v1/agents/:id/conversation-page` and `GET /v1/direct/conversations/:id/page`, and at the top
level of the `POST /v1/channels/read` page. The host adds them only on protocol 7 and only when the
request advertises the capability, so a released client reads the same bytes as before. A host
without the capability never sends them, so a client keeps them whenever they are present, and a
malformed value fails closed. The WebRTC host peer encodes the local response again with the same
option, so the fields reach the web client and a joined desktop through the data channel too.

### UI blocks

`ui-blocks-v1` carries the interactive block of an `ask_ui` question prompt (see
`packages/contracts/src/ui-blocks.ts`). It adds `uiBlock` beside the frozen keys of a message in
`GET /v1/agents/:id/conversation` and `conversation-page` (messages and references), and in the
`conversation` and `conversation-page` events. The host adds it only on protocol 7 and only for a
connection that advertises the capability. A released client reads the message as its fallback: a
question prompt that it answers through the released prompt route, and the host reads the block's
answer from those answers. A host without the capability never sends `uiBlock`, so a client keeps it
whenever it is present, and a block that the contract refuses fails closed. A privileged action (a
`danger` button, a button with `confirm`, or the primary button of a `danger` confirm), and an answer
in words on a block that has one, is for the owner and admins only; the host answers a member with
403. A secret form value goes to the agent in the tool result. The stored block and the prompt
resolution leave it out. The provider transcript of the tool call can keep it, and the agent can
repeat it in a reply or a thought, which the conversation stores as any other message.

`agent-task-ui-blocks-v1` (`team-protocol/agent-task-ui-blocks-v1.ts`) adds the same `uiBlock`, with
the same normalization and wire budget, to the task conversations of `agent-tasks-v1`: the response
of `POST /v1/agent-tasks/read` and the `snapshot` of the `agent-task-conversation` event. A client
then shows a question in a side thread as its form, such as the API key card. The host adds it only
for a connection that advertises the capability; the frozen agent-tasks-v1 decoder drops it for
every other client. The HTTP and WebRTC clients accept it whenever it is present, and the WebRTC host
peer encodes the local response and the events again with the same option.

### Subagents

`subagents-v1` carries the subagents that an agent started in one turn (see
`packages/contracts/src/ipc-conversation-subagents.ts` and `team-protocol/subagents-v1.ts`). It adds
`subagents` beside the frozen keys of a message in `GET /v1/agents/:id/conversation` and
`conversation-page` (messages and references), and in the `conversation` and `conversation-page`
events. The host adds it only on protocol 7 and only for a connection that advertises the capability.
A released client reads the message as its fallback: a `subagents` message whose text lists the
subagents by title. A host without the capability never sends `subagents`, so a client keeps it
whenever it is present, and a list that the contract refuses fails closed. The host sends each list
through `clampConversationSubagents`, so only known keys go out, and the lists of one page share a
wire budget, newest first. The task conversations of `agent-tasks-v1` do not carry it. The WebRTC
host peer encodes the local response and the events again with the same option.

### Prompt multi-select

`prompt-multi-select-v1` carries `multiSelect: true` on an agent question that takes more than one
option, such as a Claude `AskUserQuestion` question with `multiSelect` (see
`team-protocol/prompt-multi-select-v1.ts`). It adds the flag beside the frozen keys of a question in
the `questionPrompt` of a message in `GET /v1/agents/:id/conversation` and `conversation-page`
(messages and references), in the `conversation` and `conversation-page` events, in the `prompt`
event, and in the `pendingPrompts` of the `runtime-snapshot` event. The host adds it only on protocol
7 or 8 and only for a connection that advertises the capability. A released client shows the question as a
single choice, and its one answer is valid for the question. A host without the capability never
sends the flag, so a client keeps it whenever it is present, and a value that is not a boolean fails
closed. The WebRTC host peer encodes the local response and the events again with the same option.
The iPhone app advertises it through the shared team client, but it still shows the question as a
single choice.

### Context usage

`context-usage-v1` carries how full the context window of each agent is, so a desktop joined to a
server shows the context meter of that server's agents (see `team-protocol/context-usage-v1.ts`). It
adds `contextStates` and `threadContextStates` beside the frozen keys of the `snapshot` of the
`runtime-snapshot` event, with the frozen keys of `AgentContextState` and the `botId` spelling of the
rest of that snapshot. The host adds them only on protocol 8 and only for a connection that
advertises the capability, so a released client gets the snapshot that it got before and shows no
meter. The host filters the states as the rest of the snapshot, so a member gets only the agents that
the member can see. It drops a category that the capability does not name, and a state that the v1
shape cannot describe, such as a later compaction status, so a client never refuses the snapshot for
it. A host without the
capability never sends the fields, so a client keeps them whenever they are present, and a value that
the runtime snapshot decoder refuses fails closed. A new socket gets a new snapshot, so the meter
comes back after a reconnect. The WebRTC host peer encodes the events again with the same option.
Compacting the context of a joined server's agent stays local only: the Team API has no route for it.
The iPhone app advertises the capability through the shared team client, but it shows no meter.

### Queue window

`queue-window-v1` keeps the queue snapshot of a long-lived agent inside one WebRTC frame. The
mailbox keeps every finished delivery, and the released `GET /v1/agents/:id/queue` answers all of
them. After some weeks of use, that answer is larger than the 2 MiB JSON frame, so the host peer
answers `error.remote.responseTooLarge` and the phone and the web client cannot read the queue.

On protocol 7, when the request advertises the capability, `GET /v1/agents/:id/queue` and
`POST /v1/agents/:id/queue/edit` keep every queued, starting and running delivery, the `editing`
mark included. Then they keep every failed, interrupted and cancelled delivery, newest first, while
it fits in `WEBRTC_FRAME_BODY_BUDGET`: the phone and the web client show the failure reason of a
failed message, and hide a cancelled message, at any age. Only completed deliveries leave the
window: the newest 100 by `createdAt` stay, while they fit, for the receipts of recent messages.
The kept deliveries stay in queue order, and the wire shape and keys do not change. A request
without the capability, and every protocol 6 or older request, gets the full list as before.

Every current client sends `teamCapabilitiesForProtocol(7)`, so the phone, the web client and a
joined desktop get the window without other client code. A released phone keeps the full list
until it updates. `scripts/queue-window-e2e.ts` checks the frame size with and without the
capability.

### Browser control and page state

The frozen `browser-changed` event and `GET /v1/browser/tabs` drop unknown tab keys in released
clients, so two optional capabilities send their tab state on their own event and routes. A client
merges it into the tab list: the desktop main process in `remote-server-event-refresh.ts`, and the
web client in `web-client-context.tsx` and `web-runtime.ts`. A member does not see a private tab in
either one.

`browser-user-control-v1` lets any member who can see a tab take it from its agent and give it back:
`POST /v1/browser/user-control` (state), `/take` and `/release`, each with `{ tabId }` except the
state, and each answering with the held tab ids. While a person holds a tab, the owning agent's
browser tool calls on it wait until the release. The host refuses a take while a secret request is
active on the tab, and releases the holds of a session when it ends. Each change sends
`browser-user-control-changed { tabIds }`.

`browser-page-state-v1` adds `POST /v1/browser/page-state` (empty body) and `POST /v1/browser/stop`
(`{ tabId }`). Both answer with `{ tabs: [{ tabId, canGoBack, canGoForward }] }`, and each change
sends `browser-page-state-changed` with the same list. A stop ends the load at once, before the queued
tab operations, and a stop of a tab that does not load changes nothing. A client shows Stop only for a
host that reports the page state; for an older host, Back and Forward stay enabled.

`browser-sign-in-v1` adds `POST /v1/browser/sign-in` with `{ tabId, cookies }`, up to 150 cookies,
and answers with `{ cookies }`, the count that the host set. Some sites refuse a sign-in from a
data-center address, but accept the session that the member's own computer made. The desktop opens a
window on this computer (`src/main/local-sign-in-window.ts`) with its own session in memory, the
sandbox of the embedded browser, and no downloads or permissions other than a clipboard write. When
the member selects Done, it sends only the cookies of the tab's site: the tab's host, a parent domain
that is not a top-level one, or a subdomain (`browserSignInCookieFitsHost`, which both sides apply).
It leaves out Cloudflare's address-bound `__cf*` and `cf_*` cookies. The host sets the cookies in the
tab's session and loads the tab again. A shared tab uses the shared browser session, so every agent
and member on the server then has the sign-in. The host never sends the values back or records them.
On a server, the agent prompt tells the agent to stop a refused sign-in and call `request_takeover`
with `reason: "sign-in-blocked"`. The host adds that reason beside the frozen takeover projection, in
the `browser-takeover-requested` event and in `pendingBrowserTakeovers`, only for a client with
`browser-sign-in`. A client decodes a present reason and refuses an unknown one. The takeover card in
the desktop app shows the button for a web tab. With the reason, the card asks only for the sign-in
on this computer and has no "I'm done" button. A sign-in that sets cookies completes the takeover of
that tab.
The window also sends by itself (`src/main/browser-sign-in-page.ts`): after a page with a sign-in
address or a visible password field, a new `HttpOnly` cookie of the site, and then a page of the site
that is not a sign-in step. This is a guess, so after that send the desktop reads the server's tab
list. When the tab still shows a sign-in step, it opens the window's page in the tab (with
`browser-navigation`) and reads the list again. The window closes only when the tab left the sign-in
steps; otherwise it stays open and waits for the next cookie. Done sends without this check.
The desktop discards the window's session after a send that set cookies, on Cancel, and at shutdown.
A failed send keeps it, so Done can try again. The web client has no menu item: a web page cannot
read the cookies of another site.

### Skill events

`skills-events-v1` adds one optional event, `skills-changed { agentId }`. The host sends it after
each change to the installed skills of an agent: install, update, uninstall, turning a skill on or
off, and a skill an agent creates. `SkillMarketplaceService` calls its refresh callback after every
write, and that callback emits the event through `AgentService`, so this computer's windows get it
too. The event carries no skill data: a client reads the list again through `installed-skills` or
`skills-admin-v1`. `team-protocol/optional-events.ts` is the one place where each transport
recognizes the optional events that the frozen base vocabularies reject.

### Focus use

`focus-use-v1` adds `POST /v1/client/focus` with an empty body. Only a hosted server advertises it
(`focusUse` in `TeamApiOptions`), and the capability is v7 only. A client sends it while its app has
focus and the server is online, through `createFocusUsePing` in `packages/team-client`: the desktop
main process, the web client and the mobile app each give it their own focus signal and transport.
The host keeps the focus period of each session apart from `#sessionUse`, so a focused desktop does
not stop the phone's push notifications. A ping moves `lastClientUseAt` only for 30 minutes after the
later of the last user action of its session and the start of its focus period. The route is in `PASSIVE_ROUTES`, so the generic client use path
does not count it. See [hosted servers](../hosted-servers.md) step 5.

### Admin capabilities

An owner or admin of a joined server manages its host through optional `POST /v1/admin/...` routes.
Each capability has a frozen codec in `team-protocol/<name>-v1.ts`, registered in
`team-protocol/optional-routes.ts`, and both transports use it. Every route calls `requireAdmin`,
except two that also answer a member: `/v1/browser/tab-profiles` and `storage-disk-v1`. The
host advertises a capability only when its `TeamApiAdmin` member exists.

| Capability | Grants | IPC group |
| --- | --- | --- |
| `agent-admin-v1` | Agent access and auto-approve | `agentAdmin` |
| `agent-host-settings-v1` | Agent Computer Use, local scripts, and messages while it works; reads the host default | `agentAdmin` |
| `agent-backup-models-v1` | Agent backup models: the order and whether to switch without asking. Unknown providers are refused | `agentAdmin` |
| `agent-task-limit-v1` | Agent task limit: how many tasks run at the same time, 1 to 4, or the host default | `agentAdmin` |
| `browser-profiles-v1` | Named browser profiles of the host: list, create, rename, recolor, clear, delete, and the profile of each agent. One route, `/v1/browser/tab-profiles`, also answers a member: the profile label of each tab that the member can see. Cookies and site data stay on the host. Advertised when the host has `browserProfiles` | `agentAdmin` |
| `skills-admin-v1` | List, install, remove, enable skills by marketplace id | `agentAdmin` |
| `shared-tables-v1` | List and delete shared tables | `sharedTables` |
| `agent-install-v1` | Add an agent from a listing or a shared template, by id | `agentAdmin` |
| `agent-update-v1` | Update an agent added from a listing to the listing's current version, by id | `agentAdmin` |
| `providers-v1` | Code sign-in, provider API keys, managed runtimes, custom endpoints | `providerAdmin` |
| `instance-transfer-v1` | Export and import the server's agents and server settings as a transfer file | `instanceTransfer` |
| `providers-v3` | Code sign-in for Codex, Claude and Grok; send the code a Claude sign-in page shows | `providerAdmin` |
| `providers-v4` | Code or link sign-in and managed runtimes, Cursor and Cline included | `providerAdmin` |
| `claude-api-key-v1` | No routes. The host saves an Anthropic API key for Claude through the `providers-v1` key routes | `providerAdmin` |
| `provider-usage-reset-v1` | Read the usage reset credits of each provider account on the host, and spend one. Only Codex gives credits | `providerAdmin` |
| `provider-sign-out-v1` | Sign the host's own Claude or Codex sign-in out. The host's other accounts stay | `providerAdmin` |
| `host-admin-v1` | Server name and logo | `hostAdmin` |
| `host-update-v1` | Check for, download and restart into an app update; cancel a restart that waits | `hostAdmin` |
| `host-timezone-v1` | Read and set the server timezone | `hostAdmin` |
| `agent-memory-limit-v1` | Read and set how many memories each agent keeps | `hostAdmin` |
| `memory-review-v1` | Read and set how often the host's agents review their memories in the background, or Off | `hostAdmin` |
| `machine-resources-v1` | Read the disk, memory and CPU use of the host machine; read and set the alert levels and the owner or admin who gets the `machine-alert` event | `storage`, `hostAdmin` |
| `prompt-cache-ttl-v1` | Read and set how long Claude keeps the prompt cache of the host's agents | `hostAdmin` |
| `provider-default-v1` | Read and set the provider that a new agent of the host starts on | none: only the mobile app sends it |
| `agent-access-v1` | Read and set the roles that give members access to agents (see [Roles](#roles)) | `hostAdmin` |
| `discord-access-v1` | Read and set which Discord roles can use OpenBot in a Discord server; list its roles | `messaging` |
| `events-v1` | Manage webhook routines, their secrets, and activity | `events` |
| `routine-recovery-v1` | Read and set a routine's missed-run policy; read its runs with the missed occurrences | `events` |
| `routine-results-v1` | List the messaging connections and their places; read and set where an agent routine sends its answers. Deliveries stay on the host | none: only the mobile app sends it |
| `webhook-tests-v1` | Send one signed test event to a webhook routine | `events` |
| `vault-v1` | The host's Vault: list, add, change and delete logins, cards and contact info; show one saved password, card number or security code; reset a Vault that the host cannot read. No CSV import. A change sends `vault-changed` with no data, so a client reads the list again | `vault` |
| `vault-v2` | All of `vault-v1`, under `/v1/admin/vault/v2/`, and API keys as a fourth item kind: list each key's variable name and notes, add, change and delete keys, and show one saved key. The host leaves API keys out of every `vault-v1` answer, and `vault-v1` cannot delete or show one, so an older client keeps a valid list. It uses the `vault-changed` event of `vault-v1` | `vault` |
| `vault-import-v1` | A CSV password export that an owner or admin sends as text, at most 256 KiB, below the JSON body limit. The host adds its logins as from its own file dialog and answers only the counts. The iPhone app uses it; the phone never calls the `vault-v1` reveal or reset | none: only the mobile app sends it |

These IPC groups take a required server id and route with `scopedHandler`. A key travels only towards
the host; no response carries one, except the `vault-v1` and `vault-v2` reveal: it answers the one secret that the
admin asked to show or copy. `providers-v1` has no progress event, so the renderer reads runtime
status again every second while a host download runs. Publishing, macOS permissions, the browser
sign-in and folder import stay on the host.

`providers-v1` signs in Codex only, with a device code. A host that serves `providers-v3` also signs
in Grok (`grok login --device-auth`) and Claude (`claude auth login`), for a host with no visible
browser, such as a hosted server. `src/backend/agent/cli-code-login.ts` reads the link, and for Grok
the code, from the CLI output. The Claude CLI shows its paste prompt only on a terminal, so the host
runs it under the util-linux `script`, and the admin sends back the code that the Claude page shows
(`code-login/submit`). This flow runs only on a Linux host: the macOS `script` refuses a socket for
stdin, and Windows has no `script`. So only a Linux host advertises `providers-v3`; a macOS or
Windows host keeps `providers-v1`, and its clients offer the Codex code sign-in only. The CLI output and the pasted code are secrets; no log line or
error quotes them. How a sign-in ends arrives in the host's agent status, as for Codex.
`serverCodeRouteProviders` in `server-capabilities.ts` picks the providers that the Providers list offers
for a code sign-in, from the host's capabilities.

`providers-v4` adds Cursor and Cline to the sign-in and to the runtime routes. Every host with
provider admin advertises it, so a client offers the Claude sign-in only when the host also has
`providers-v3`. Cursor uses a `link` sign-in: the host runs `cursor-agent login` with
`NO_OPEN_BROWSER=1`, which prints the sign-in page and waits until the page signs the CLI in, so
the admin only opens the page. The ACP `cursor_login` method stops when it cannot open a browser,
so a peer never starts it. Cline uses a device code: the host runs `cline auth -p cline`, which
prints the code before its page. The parser accepts a link only after its line ends, because a
chunk can stop inside one.

When the account is an owner or admin of the active remote server, the server serves `providers-v1`,
and the server has no agent, the workspace shows `ServerOnboarding` before the first-agent form, on
desktop (`WorkspaceServerOnboarding`) and on the web (`WebWorkspace`). It shows the host's providers
through `hostSetupProviderProps`, and Continue stays blocked until a provider is connected. The form
then opens with that provider. The choice stays in memory for the server; it is not written to the
setup file of this computer. A member, the local server, and a host without `providers-v1` open the
form directly.

`host-timezone-v1` reads and sets the server timezone (`openbot-server-timezone-v1.json`; `null` is
automatic, the system zone of the host). When an agent creates a routine, the zone comes from the tool
call first, then from the sender's last message in that turn, then from this setting. The sender's
zone stays in memory only, so after a restart a queued message uses the server timezone. Agent import
and instance transfer use it in place of the system zone. A change does not move existing routines.

`agent-memory-limit-v1` reads and sets how many memories each agent of the host can keep. It is the
same value as "Memories per agent" in the host's own Server settings. The snapshot gives the limit and
the values that the host permits; the host refuses other values. A change reloads the threads of each
agent, because their instructions state the limit, and the host's window shows the new value in each
agent's memories (`app:agent-memory-limit`). A lower limit deletes no memories. The limit does not
change the 8,192-byte budget of essential memories. Server settings → General → Agents is the only
place that sets the limit, for this computer (`hostAdmin.setAgentMemoryLimit`, local handler) and for a
joined server. App Settings does not show it, so that one name does not have two values.

`memory-review-v1` reads and sets how many completed turns of one conversation pass between two
background memory reviews of the host's agents (`openbot-memory-review-v1.json`; 10, 20 or 40, default
20; `0` is Off). The snapshot gives the value and the values that the host permits; the host refuses
other values. The agent service reads the value at each use, so a change applies from the next turn.
Server settings → General → Agents → Memory review sets it for this computer
(`hostAdmin.setMemoryReview`, local handler) and for a joined server.

`prompt-cache-ttl-v1` reads and sets how long Claude keeps the prompt cache of the host's agents
(`openbot-prompt-cache-ttl-v1.json`; `5m` or `1h`, default `5m`). With `1h` the host starts each
Claude process with `ENABLE_PROMPT_CACHING_1H=1`. Claude Code reads this flag before its subscription
rules, so subagents and a subscription that uses extra usage also get 1 hour. With `5m`, the default, it
sets nothing, so Claude Code uses its own choice: 5 minutes with an API key, 1 hour for the main thread of a
subscription within its limits. A `promptCacheTtl`
in the Claude settings or `CLAUDE_CODE_PROMPT_CACHE_TTL` on the host still wins. A change applies to
the next Claude process, not to a running one; an idle thread starts a new process when it resumes.
The Cache section of the Claude page in Server settings → Providers sets it for this computer and
for a joined server.

`provider-default-v1` reads and sets the provider, and the model beside it, that a new agent of the
host starts on when its creator chooses none. It is the setup choice of the host (`openbot-setup`
file, `preferredProvider` and `preferredModel`): a set writes the file and calls
`AgentService.setPreferredProvider`, as the local Settings save does. A read gives the provider that
`AgentService.preferredProvider` uses now, so a host before its setup choice reads `codex`. A
provider that the client's protocol does not show reads as none (`provider: null`), and the host
refuses to set it. The phone's Server settings → Providers sets it. The desktop sets it only for this
computer. A remote set also sends the new setup to each window of the host (`app.setupState`), so
its Settings show the change at once.

`claude-api-key-v1` has no routes. It tells a client that the host reads the key that the released
`providers-v1` key routes save for `claude`. The host keeps the key as a Claude account with the
fixed id `CLAUDE_API_KEY_ACCOUNT_ID`, which `provider-accounts-v1` lists as any other account, so an
older client can select it too. The agents on it start with `ANTHROPIC_API_KEY` and their own
`CLAUDE_CONFIG_DIR`, and Anthropic bills each request to the key. The provider's own sign-in first
checks its claude.ai login without the key. Only when it has no login does it use the key; it then
reports the account type `claude-api-key`, and the host hides the key account row, because each
agent already uses the key. A removed key removes its account and moves its agents to the own sign-in.
A removed account with a saved key comes back at the next account check. An added account never gets
the key. An older host saved the key but did not use it, so a client shows the Claude key only when
the host advertises the capability.

`host-update-v1` runs the same update as the host's own Settings. `src/main/requested-update.ts`
keeps the schedule in memory: who asked, and whether the restart waits until
`describeRestartReadiness` reports no running work or happens as soon as the update is ready. The
host user can turn the routes off with "Allow updates from server members" (`openbot-update-preference-v1.json`,
default on) and can cancel a restart that waits. The host still advertises the capability when the
setting is off, so the client can show why. A Host Manager tenant refuses the routes. The client
reads the status again every second while a check, a download or a restart runs. An admin can also
set the host's automatic download and automatic install when idle through the settings route; an
automatic install is a schedule with no requester.

`server-update-flow.tsx` reads the update status once on each connection of a member with update access.
The sidebar header then shows an update button next to the server name. Each time the user enters a server
that has a new version, the update dialog opens again; it stays closed on a reconnect to the same server. The dialog confirm calls `start`, which downloads and restarts in one call. The
dialog reads the status while the update runs and follows the connection until the host is back with
the new version. A hidden dialog keeps a notice with the live status, also after a server switch on desktop; entering the server then does not open the dialog again. The web client reads only the connected host, so it stops following the update when the user leaves that server; the header button shows the update again on return. A host that still waits to restart after a connection drop did not restart. All members get the `host-restart` event
(`waiting`, `restarting`, `none`) from the host's event stream, and the host sends the current state
again when a client declares the capability. Like `channelEvent`, the event skips the frozen v1-v3
event encoders at each hop (host peer, client transport, `remote-peer.ts`, SSE stream). A client that
loses the host while a restart waits treats it as the restart: desktop keeps the fast WebRTC retry
instead of the `host_unavailable` wait for 10 minutes, and web tries again every 5 s for 3 minutes.
`host-restart-toast.ts` shows the notice until the host is back, for 10 minutes at most.

### Roles

`agent-access-v1` limits the agents that a member can use. Its routes are `/v1/agent-access` and
`/v1/agent-access/set`, not `/v1/admin/...`, because each member reads their own levels there. Each
agent has one of four levels for a member:

| Level | The member can |
| --- | --- |
| `none` | Not see the agent. The host treats it as hidden for that member: its list, events, push and Live Activity leave it out, and its routes answer 404. |
| `view` | Read the agent's conversations and files. Each write answers 403 `error.team.agentViewOnly`. |
| `chat` | Also send, react, interrupt, edit the queue, ask a side question, reset the context, use tasks, and answer the agent's prompts, approvals and browser requests. |
| `manage` | Also change the agent's settings, routines, memories, skills and publication (403 `error.team.agentManageDenied` below it). Delete stays admin only. |

The **Everyone** role holds a level for each agent, `manage` for an agent that it does not list. A
custom role holds a name, a level for each agent (`none` for an agent that it does not list) and its
member IDs (`TeamMemberSummary.id`). A member gets the highest level of Everyone and of each role that
names them. An owner or an admin always gets `manage`. So a server with no roles works as before, and
a new agent is open to every member until an admin closes it.

The host keeps the roles in `openbot-agent-access-v1.json`, by server ID (`src/main/agent-access-store.ts`).
It is a preference file, not the database: there is no migration, and an older build ignores it, so a
downgrade keeps the roles. A file that does not decode closes every agent to members until the next
save. Nothing goes to the account service. An owner or admin reads the whole set; a member reads only
`mine`. A save sends the whole set with the revision that it read, and the host answers 409 when another
admin saved after it; the client then reads the set again. A save changes only the levels of the agents
that the admin can see, and drops the levels of deleted agents. A duplicated agent gets the levels of its
source before the copy shows to clients, so a copy does not open memories that the source closed. The host removes a member from each role when the member leaves, and after
each change it sends `agent-access-changed` and a new `agents-changed` to each connection, so the agent
lists of members change without a reload.

Server settings → Roles (`ServerRolesSection.tsx`, `@openbot/ui/features/servers/ServerRoles`) edits the
set on desktop and web. The role menu of each member row on the Members page sets the server role
(Member or Admin, through the same confirmation as before) and the custom roles. The tab shows for the
local server and for a joined server whose host advertises the capability to an owner or admin.

Known limits:

- The composer does not show that a `view` agent is read only; the host refuses the send.
- `GET /v1/attachments/:id` does not check the agent of the attachment.
- Channel messages of an agent that a member cannot see stay in the channel. A send to a channel does
  not check the levels of the agents in it; only a save that adds an agent checks `chat`.

### Webhook routines

A webhook belongs to its routine. The host keeps the trigger, the encrypted secret, and receipts in
SQLite. D1 keeps only the route ID, the host, and the owner account.
Signal sends each signed request to the connected host without a cloud queue. All `events-v1`
routes need a host administrator. See [Webhook routines](events.md) and the
[webhook guide](../webhooks.md).

## Desktop server notifications

Each desktop profile stores muted server IDs in `servers.json`. `RemoteServerStore` saves a
mute change before publishing it. These preferences survive restart, re-login, and host-list
reconciliation. The server context menu controls mute for local and remote servers.

`renderer-forwarders.ts` continues to deliver live events for muted servers, but suppresses
system notifications. Remote notification content uses the source server's agent list. Both
server mute and per-agent notification settings apply. Unread state is unchanged. The iPhone app
has its own level and mute for each server, which the host applies to the notifications it sends to
that phone (see [iPhone notifications](channels-and-messaging.md#iphone-notifications)). Mute
settings are not synchronized between devices.

## Billing

Billing is per server. One account can pay for several servers; each server has its own Stripe
subscription. The Account Worker (`apps/auth-api/src/server/billing-service.ts`) talks to the Stripe
REST API with `fetch`; there is no Stripe SDK. The plan catalog in `packages/contracts/src/billing.ts`
holds the plan IDs, storage, member and site limits, relative speed and lookup keys, and no amounts. The amounts are six Stripe Prices with the lookup
keys `openbot_{plan}_{interval}`. `bun run api:stripe:bootstrap` (`scripts/stripe-bootstrap.ts`)
creates them and the Customer Portal settings.

- The add server dialog starts a plan. The hosting service
  (`apps/auth-api/src/server/hosted-billing.ts`) makes the Stripe customer before the Checkout, so
  two open Checkouts use one customer. The Checkout sets the subscription metadata
  `openbot_user_id` and `openbot_server_id` (`BILLING_METADATA`). The billing service calls the
  `onSubscriptionSynced` hook after each subscription sync; the hosting side uses it to provision,
  stop and resume servers, so billing does not know about boat. See
  [hosted servers](../hosted-servers.md#lifecycle). The webhook links a new Stripe customer to the
  account from `openbot_user_id`. It never moves a known
  customer to another account, and it skips a subscription that names no account.
- Desktop Settings → Billing and the web Billing dialog render `@openbot/ui/features/billing`: one
  row for each open plan, with the server name, the plan, its price, and its renewal controls.
  Hosted plans support cancellation that keeps data, Keep server, and explicit deletion now or
  after the paid period. A stored deletion date and subscription ID drive the cron; a fresh
  terminal Stripe state and a per-server operation lease guard deletion. See
  [server deletion](../hosted-servers.md#billing-and-server-deletion). The price is the list price of the Stripe Price in the subscription's currency (from
  `currency_options` when that is not the Price's base currency), before discounts and tax. The
  webhook stores it with the subscription. The
  account button opens the Customer Portal for the payment method and invoices.
- Desktop calls the `billing` IPC group; the main process gets a Customer Portal URL from the Worker,
  checks that it is a `billing.stripe.com` page, and opens it with `shell.openExternal`. The IPC takes
  no URL. The web client does the same check before `location.assign`. Checkout URLs get the same
  check for `checkout.stripe.com` (`isStripeCheckoutUrl`).
- The change and cancel actions open the Portal flow of one subscription. The Worker first checks
  that the subscription belongs to the account.
- The server name comes only from a `remote_hosts` row that the same account owns. A plan whose
  server was removed stays in the list, because Stripe bills it until the account cancels it.
- The webhook (`/v1/stripe/webhook`) checks the Stripe signature, records the event ID to ignore a
  repeat, and gets the subscription from Stripe again before it writes the D1 row. So the order of
  events has no effect.
- Without `STRIPE_SECRET_KEY` billing is off: the state is `available: false`, and the Portal route
  and the webhook answer 503.

Rule: plan limits read `getServerEntitlement` (`apps/auth-api/src/server/billing-entitlement.ts`)
only. It decides which statuses and grace periods give a server a plan, and it counts a plan only
for a server that the paying account owns. Do not read `billing_subscriptions` or a Stripe status in
another place.

### Commercial license

The license is a second Stripe product next to the server plans
(`packages/contracts/src/license.ts`). One account has at most one open license. Its subscription
quantity is the number of users. There are two tiers, Starter and Team. Each tier has a monthly and a
yearly price, and each of these has a bundle price for an account that pays for a hosted server. That
gives 8 Stripe prices (`LICENSE_PLANS`):

| Plan | Lookup key | Month (EUR) | Year (EUR) | Users |
| --- | --- | --- | --- | --- |
| Starter | `openbot_license_starter_{month,year}` | 10 | 96 | 1 |
| Starter bundle | `openbot_license_starter_bundle_{month,year}` | 9 | 86.40 | 1 |
| Team | `openbot_license_{month,year}` | 25 for 2 users, + 15 for each extra user | 240, + 144 | 2–10 |
| Team bundle | `openbot_license_bundle_{month,year}` | 22.50, + 13.50 | 216, + 129.60 | 2–10 |

A year is 12 months less 20% (`LICENSE_YEAR_DISCOUNT_PERCENT`). The bundle discount
(`LICENSE_BUNDLE_DISCOUNT_PERCENT`: 10%) comes off after it. The amounts are
in `LICENSE_PLAN_PRICES` (EUR is the base currency; USD and PLN are `currency_options` with their own
amounts). Team prices are graduated; the 1-user prices are flat. `stripe-bootstrap.ts` creates each
price with the metadata `openbot_license_tier`, `openbot_license_interval` and
`openbot_license_bundle`, and `licensePlanFromPrice` reads them. A price with no metadata is Team monthly: the license from before
the tiers used the same lookup key. The license terms allow 3 devices for each user
(`LICENSE_DEVICES_PER_USER`); the app shows this and does not count devices.

- A checkout names `tier: "starter" | "team"` and `interval`. A request with no tier is Team monthly,
  as an app before the tiers sends. The Worker sells the bundle price when the account pays for any
  hosted server plan (`accountHasServerPlan`: active, trialing, or past due in the grace period). The
  `licenses` row stores `bundle`. After each server plan sync, `LicenseService.alignBundlePrice` moves
  an open license to the price of its tier and interval with the bundle that the account now has, with
  `proration: none`, so the change starts at the next renewal. It logs a Stripe failure and does not
  fail the sync.
- A server create can order a license (`license: {tier, users}` in `POST /v2/hosting/servers`). The
  Worker refuses a Team license on a Starter server, and more Team users than the server plan has
  members (400 `invalid_hosted_server_request`). An account with an open license gets 409
  `license_exists`. Fewer users than the people in use get 409
  `license_users_in_use`, as a license checkout does. One Checkout page then has 2 line items: the server price, and the license bundle
  price for the same interval and currency, with the users as its quantity. The customer pays one
  invoice. On the first sync of the paid subscription, `LicenseService.splitOrder` makes a license
  subscription with the metadata `openbot_order_subscription` (the server subscription), anchored at
  the server period end with `proration_behavior=none`, so its first invoice is 0. Then it deletes the
  license item from the server subscription, also with no proration. Each later sync runs the split
  again until it is done, and the metadata stops a second license subscription. The sales ledger
  divides the order invoice into a server fact and a license fact, and ignores the 0 invoice of the
  split. The Checkout session metadata keeps the order, so "Open the payment page again" makes a page
  with the same license, unless the account has a license by then.
- Promotion: the Worker setting `LICENSE_TRIAL_END` (ISO 8601, in `wrangler.jsonc`; empty turns it
  off) makes each new license free until that time. `LicenseService.trialEnd()` gives it while it is
  at least 49 hours away, because Stripe Checkout needs a `trial_end` 48 hours ahead; after that the
  license sells at full price. `GET /v1/me/license` then has `trialEnd` (ms), and the app shows
  "Free until" with the date in UTC. A license checkout sets `subscription_data[trial_end]`, so the
  license is `trialing` and the first charge is on the trial end. A server order during the promotion
  has no license item: the server is the only line, and the session and subscription metadata keep
  the order (`openbot_order_license_{tier,users,interval,trial_end}`). `splitOrder` then makes the
  license subscription at the bundle price with `trial_end` (at least 1 hour ahead, for a late
  webhook) and removes the order metadata from the server subscription. The 0 trial invoice is a
  `first_purchase` sales fact of 0, and the charge on the trial end is a `renewal`. Apps before the
  promotion ignore `trialEnd`; Stripe Checkout still shows the trial.
- The 1-user tier refuses `POST /v1/me/license/users` with 409 `license_one_user`.
  `POST /v1/me/license/plan` sells upgrades only: Starter to Team monthly or yearly, and
  Team monthly to yearly. It bills the difference now (`always_invoice`,
  `payment_behavior=error_if_incomplete`). Any other change is 409 `license_plan_change`: to go down,
  the owner cancels at the period end and buys again.
- The `licenses` table stores `tier`, `billing_interval` and `bundle` (migration `0041`). NULL is Team
  monthly.
- Users are people, not servers or computers: the owner, plus each distinct account that is an
  active member (`remote_memberships`) of a server that the owner owns. AI agents and chat-app
  participants do not count.
- While the license is open, it is a hard limit. `RemoteControlPlane` adds
  `LICENSE_SEAT_AVAILABLE_SQL` to the member seat check of an invite accept and a reactivation, in the
  same statement as the server plan limit. A full license refuses a new person with 409
  `license_users_full`. A person that the license already counts can join another server of the
  owner. Members who joined before are never removed. Without an open license, only the server plan
  limit (`getServerEntitlement`) applies.
- `apps/auth-api/src/server/license-service.ts` owns the `licenses` D1 table (migration `0038`).
  The billing webhook gives a subscription with the license lookup key to `LicenseService.sync` and
  writes nothing to `billing_subscriptions`. A Worker before the license sees an unknown plan and
  skips the event, so an old Worker keeps working.
- Routes: `GET /v1/me/license`, and `POST /v1/me/license/checkout`, `/users`, `/plan` and `/renewal`. The
  state is `available: false` only when the Worker has no billing, and the app then shows nothing.
  When Stripe has no active license price (it is archived to pause sales), checkout returns 503
  `license_unavailable`, and the app shows a toast with the sales address. An app on a Worker
  without these routes gets 404 and also shows nothing.
- A Stripe customer pays in one currency, so a new license uses the currency of the account's open
  subscriptions, and a server checkout in another currency gets 409 `billing_currency`. Add server
  opens in that currency and does not let the user change it. Checkout cannot buy fewer users than are in use. An increase is charged at once
  (`always_invoice`). A decrease starts at the next invoice and cannot go below the users in use or
  below 5. The subscription metadata `openbot_paid_users` and `openbot_paid_period_end` keep the
  users paid in the current period, so an increase after a decrease charges only the users above
  that number.
- Checkout keeps one open page that sells a license for each account: a license page, or a server
  order page with a license. After it makes a page, it closes the older pages of the customer that
  sell a license, so two requests at the same time return the same page. When a newer page sells a
  license, the new page closes with `license_exists`. It then reads the customer's subscriptions in
  Stripe, not only D1, so a license paid before its webhook, or a paid order before its split, stops
  the new page with `license_exists`. A second open license can still come from the
  Stripe Dashboard; `sync` logs a warning, and a person refunds it.
- Refunds are by email only; the app and the Worker have no refund action. A customer emails
  licenses@openbot.run within 24 hours of the first payment for a refund less a €3 / $3.60 /
  13.20 zł fee, once per account. There are no refunds for later changes.
- When the owner of a full license creates an invite, the members section asks to add 1 user and
  shows the extra price, then adds the user and creates the invite. A 1-user license changes to Team
  monthly for 5 users in place of the added user. At 25 users it shows "Contact
  us" and creates no invite. Admins get no step; the join tells the person that the license is full.
- Desktop calls the `license` IPC group; the web client calls the browser routes. Both render
  `@openbot/ui/features/billing/LicenseSection` in the license slot of `BillingPanel`.

## Servers on this computer

The desktop can run more servers on the same computer. Each one is a separate workspace: its own
`openbot.db`, agents, chats, workspace folders, server settings, MCP servers and browser data. App
preferences and the account sign-in stay with the desktop. The first server, "Local", does not
change.

Each extra server is a headless child process of the same binary (`src/main/local-server-child.ts`).
`LocalServers` (`src/main/local-servers/local-servers.ts`) starts it with its own `--user-data-dir`
(`<userData>/local-servers/<id>`) and its own agent root (`~/OpenBot/Servers/<id>`). The child
sets up a password host whose one member is the owner, starts the Team API on loopback only, and
writes one ready line to stdout with the API address and its identity. The line has no secret. The
desktop pins the identity at the first start, signs in as the owner with the password, and attaches
the server as a joined server with `thisComputer: true`. `kind` stays `"remote"`.

- **Registry.** `openbot-local-servers-v1.json` in the desktop userData. The owner password is 32
  random bytes, sealed with the secret storage cipher. A file that this build cannot read is
  read-only: no server starts and no write replaces it. Folder names come from a UUID, so a
  changed file cannot name another path.
- **Connection entry.** The server is an HTTPS entry in `openbot-remote-servers-v1.json`. The
  directory sync keeps it. While the child is stopped, the entry has the address
  `http://127.0.0.1:0` and no token, so a client never reaches an old port.
- **Lifetime.** The child ends when its stdin closes. Teardown step 57 stops all children before
  the joined-server connections close (step 60). The sibling scan before an update leaves out the
  child PIDs. After an unexpected exit, the desktop starts the child again after 5 seconds, at most
  3 times in 10 minutes. The owner password is registered for redaction and is never logged.
- **Delete.** The desktop stops the child, removes the entry, and moves both folders to the trash
  with `shell.trashItem`. It never deletes them.
- **Rename.** The `host-admin` identity route, as on any joined server that the user owns.

Limits:

- A user can create at most `LOCAL_SERVER_LIMIT` (5) servers on this computer, in addition to
  "Local", because each one is a full OpenBot process that runs all the time. `LocalServers.create`
  refuses one more with `error.remote.localServerLimit`. The create dialog tells the user before
  they type a name.
- A child server is reached as a joined server. Features behind `kind === "local"`, such as
  Computer Use, voice and the local browser dock, work only as far as the Team API carries them.
- Only this computer can connect. The child does not publish to the account service and has no
  WebRTC, so phones, the web client and other members cannot join it.
- The provider CLI sign-ins in the home folder (`~/.codex`, `~/.claude`) and `~/.agents/skills` are
  shared with the other servers.
- Not confirmed: the memory of each child, the agent browser in a child with no window, and which
  process gets an `openbot://` link on macOS.

## macOS Host Manager

`scripts/macos-tenant-setup.swift` is a separate administrator command for new Standard accounts.
It uses OpenDirectory directly, creates only new empty homes, and stores generated credentials
in a new root-only file before account creation. It is not installed or called by the daemon.
The Host PKG installs this as `create-tenants`, alongside the standalone `openbot-host` CLI.
`openbot-host-service.ts` owns setup/verification sequencing; `openbot-host-macos.ts` owns OS
operations. Passwords cross only the native helper's captured pipe and the administrator's tty,
not the host protocol. The root-only recovery file is removed after successful presentation.
`build-host-installer.ts` and `verify-host-installer.ts` own release packaging and the exact
payload manifest. Package installation preserves host registration and state; only the application
is automatically updated. A Host Manager upgrade requires an administrator-installed signed PKG.

The optional standalone root helper (`scripts/host-manager.ts`) uses the lifecycle in
`src/main/host-manager.ts` and fixed macOS operations in `scripts/host-manager-macos.ts`.
`src/main/host-update-coordinator.ts` is the unprivileged tenant client, not an update leader.
The local protocol types live in `packages/contracts/src/host-manager.ts`; bounded file parsing
and owner checks live in `src/main/host-update-files.ts`. Only the helper publishes host control
state or replaces the shared application. It has no dependency on tenant storage services.
The tenant process owns an in-memory activity generation in `src/backend/restart-activity.ts`.
Backend work and main-process sessions advance it, so work between status polls resets the idle
grace. This counter contains no user data and is never sent to the host. Health and restart
readiness remain false until agent initialization succeeds.
See [multi-tenant hosting](../multi-tenant-hosting.md) for installation, permissions, and acceptance.

## Hosted servers

A hosted server is one [boat](https://boat.dev) sandbox for one account. It runs the Linux
OpenBot build under Xvfb and is a normal Remote host after its first start. The account Worker
owns the sandbox lifecycle: it creates, resumes and deletes sandboxes, and D1 keeps the desired
and observed state. A server reports each minute while it is in use, and the Worker stops it after
15 minutes with no report. boat also stops each sandbox at the end of a 2-hour lease that activity
extends. When boat stops a server in use, the Worker resumes it, and clients ask the Worker to
start a stopped server when a connection fails. No message
waits in the Worker while a server is stopped; the client keeps it and connects again. The Worker's boat key cannot read files or run commands in a
sandbox. On a hosted server only, main reads the memory of the machine, and the backend holds new
turns while it is low and limits the turns that run at the same time. See
[hosted servers](../hosted-servers.md) for the flow, the configuration, the memory guards and the template.

A self-hosted server uses the same Linux build, scripts and units on the owner's own computer, with
`/opt/OpenBot/hosted/mode` set to `self`. It has no claim: main starts in server mode
(`src/main/server-mode.ts`, `OPENBOT_SERVER=1`), and the `openbot` terminal command signs it in over
a Unix socket in the 0700 runtime directory of the service user. Main publishes the host after each
sign-in. See [self-hosted servers](../self-hosted-server.md).

### Remote release checks

`host-release-v1` adds release status and check routes for all signed-in server members. It does not change
`host-update-v1`, which still refuses installation requests and checks when updates are managed
or disabled. The new check reads only the official stable release manifest for the host platform
and architecture. It never installs files, restarts the host, or changes update preferences.
The host checks that the manifest contains a compatible asset and returns only version, phase,
and installation method. Feed errors return a safe status and can be retried.
The method is `self-update` when the host's updater can install, also in a container of
`docker/instances`, whose host pulls the image on request
([Updates from the app](../docker.md#updates-from-the-app)). Other containers report `container`.

`HostReleaseService` owns release discovery. `RequestedUpdate` still owns idle restarts and
`UpdateService` still owns app updates. Desktop and web use the new capability when available;
older hosts keep their existing update controls. The status poll is passive and does not keep a
hosted server awake. Mobile shares the protocol codecs but has no new update screen.

`host-member-update-v1` adds `/v1/host/update/status`, `/check`, and `/start` for all active,
signed-in server members. It reuses the released update snapshot. The start body is empty:
requests always wait for idle time and preserve any existing schedule. Host restrictions still
apply. Cancellation, preferences, and forced restarts stay on the administrator-only
`host-update-v1` routes. Desktop and web clients show member controls only after this capability
is negotiated; older hosts keep the administrator-only panel.
