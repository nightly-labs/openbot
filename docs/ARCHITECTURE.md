# OpenBot architecture

OpenBot is a Bun workspace with a desktop application, a mobile application, two Cloudflare Workers,
a self-hosted Signal service, and shared packages.

## Workspace map

```text
apps/
  auth-api/          Cloudflare Worker for public web, accounts, memberships, and connection tickets
  mobile/            Expo React Native client for remote team hosts
  site-router/       Cloudflare Worker that serves published sites from private R2 storage
packages/
  brand/             Shared logos, avatars, and design tokens
  contracts/         Process and network boundary types, limits, and pure validation
  logging/           ts-log Logger interface plus the redacting console/file implementation
  team-client/       Shared team connection, recovery, and WebRTC framing code
  user-errors/       Shared user-facing error messages for desktop and mobile
remote/
  api/               Bun Signal service for SDP, ICE, ticket checks, and TURN credentials
  scripts/           Bun checks and update commands for Signal and coturn
src/
  backend/           Agent runtime, provider adapters, event storage, queues, and browser host
  main/              Electron lifecycle, trusted IPC, host server, and operating-system adapters
  preload/           Narrow typed bridge from Electron main to the renderer
  renderer/          SolidJS user interface
scripts/             Development, smoke, release, and package verification entry points
```

The desktop application stays at the repository root. Its package metadata is also the release
metadata used by Electron Builder and GitHub releases. Moving it into `apps/desktop` would create a
second version source and add package-signing risk without adding a useful runtime boundary.

## Dependency direction

Dependencies point toward stable boundaries:

```text
renderer ──► @openbot/contracts ◄── preload ◄── main ──► backend
                        ▲                             │
                        └──────── auth-api ──────────┘
```

- `packages/contracts` has no Electron, Node.js, SolidJS, provider, or Cloudflare dependency.
- The renderer cannot import `src/main` or `src/backend`.
- The preload bridge contains no business rules. It maps typed calls to IPC channels.
- Electron main validates untrusted IPC input before it calls a service.
- Provider code cannot write UI state. It sends events to `AgentService`, which writes SQLite
  projections before the main process sends changes to the renderer.
- The auth API cannot import desktop implementation files.

MP3 and MOV attachments use the existing file attachment contract with no inline preview. Import
copies and hashes the original bytes under the shared attachment limits; it does not run media
codecs or extract frames or transcripts. MIME types come from the file extension for these formats,
so a supplied image or text MIME type cannot enable a preview. Remote support is additive through
the `media-attachments` capability; released protocol adapters keep their existing meanings.

## State ownership

- `openbot.db` is the source of truth for OpenBot agents, conversations, queues, reactions,
  attachments, and provider-session bindings.
- `MailboxStore` owns attachment records, staged generated attachments, mailbox commits, and the
  file-deletion outbox. `AttachmentFiles` owns draft and transfer files: copying, size limits,
  hashes, manifests, managed-path checks, and cleanup. It does not read or write the database.
  Generated response attachments become visible only after the conversation and mailbox commit
  succeeds. Agent deletion and queue edits record file removals in the mailbox transaction; the
  deletion outbox retries failed removals.
- `~/.codex`, `~/.claude`, and `~/.grok` are provider-owned login and resume state. They are not OpenBot
  conversation storage.
- D1 is the source of truth for central accounts, remote membership, invitations, and logical sessions.
- A local team host owns conversations, files, agents, and the local member projection used by Team API.
- `browser-tabs.json` is the embedded browser's own durable state, outside `openbot.db` and outside the
  migration runner. It is versioned in the file (`v1` predates the per-tab `BrowserEnvironment`, `v2`
  carries it) and always rewritten as the current version, so a downgrade reads a file it does not know.
  Nothing copies it first, so `src/backend/browser-state.ts` re-validates every bound it reads rather
  than trusting it: a tab whose environment fails validation is still returned, without that
  environment, because losing the user's open tab is worse than losing an emulated viewport.
- Renderer signals and stores are projections for the current screen only. They are not durable
  state, and one concern is one record - a row of parallel signals over its fields lets a screen
  hold states the product does not have.
- The desktop conversation context owns one record per agent inside the keyed server scope.
  Page, read, runtime-message, and removal commands keep its fields together. Other domains cannot
  write its store. Automatic-read retry markers stay above that scope; composer drafts and
  in-flight attachments keep their existing controller lifetime. The conversation view scope
  composes behavior stores. Search requests, highlights, timers, and cleanup belong to the search store.

## Browser tool execution

`browser-tools.ts` defines provider schemas and parses each call into a typed tool and its arguments.
`browser-tool-actions.ts` maps input tools to CDP operations. It does not own tabs or import the host.
`BrowserHost` owns tab access checks, operation queues, focus, deadlines, and persistent browser state.
Input dispatch runs inside those checks and queues. Upload staging also uses the shared parser before
it checks local file access.

## Provider CLI updates

The runtime manager downloads and verifies the CLI version pinned by OpenBot. The provider runtime
holds new turns while it installs and activates that managed executable. It keeps the previous client
until the candidate is ready; activation failure removes the rejected artifact and preserves the old
runtime. Download status stays `finishing` until activation succeeds.

CLI resolution prefers an explicit `OPENBOT_*_PATH`, then the installed managed copy, then an
automatically discovered system CLI. Updates never run the system CLI's updater. An explicit path
suppresses managed update offers. Startup uses the same selection and reads the executable's version.

## Agent communication policy

The shared developer instructions keep routine teammate exchanges internal by default. Agents
should start or resume work without narrating setup, context loading, discovery, or readiness.
Progress updates focus on meaningful outcomes, completed work, material changes, blockers, failures,
and required user input or approval. Delegated work still needs an explicit reply to the requesting
teammate; acknowledgements must not become loops. Relevant findings belong in the task result, and
the user can ask for a detailed coordination report.

This policy lives in `src/backend/agent/developer-instructions.ts` and is supplied on both thread
start and resume. Codex receives `developerInstructions`; Claude appends them to its system prompt;
Grok receives them as a tagged instruction block in normal turn input. There is no model-specific
verbosity setting or response filter. Delivery is tested, but compliance depends on the provider,
model, and existing conversation context; Grok's input block is not a dedicated system message.
Restarting the app reapplies the current policy without deleting conversation history. The policy
does not hide mailbox records, tool activity, approvals, or failures in desktop or mobile clients.

### Model evaluation scenarios

Run these scenarios in an isolated test profile with two agents, separately for Codex, Claude, and
Grok. Record provider/model versions, prompts, and observed responses. Repeat collaboration after
an app restart using the same conversation, including one with earlier verbose coordination.
These are manual model evaluations, separate from the fake-provider lifecycle regression tests.

| Scenario | Expected behavior |
| --- | --- |
| On a new conversation, ask an agent to research a topic with one teammate. | Work begins without a setup, discovery, or readiness monologue. |
| Exchange routine scope clarifications and acknowledgements during that task. | No user-facing message-by-message recap or acknowledgement loop. |
| Have the teammate finish its research and send findings back. | The requesting agent receives the result; the user receives a concise useful synthesis. |
| Have the teammate report a failed step, a blocker, or a finding that changes the recommendation. | The user sees the consequence and any required decision. |
| Include a step that requires approval or clarification. | The existing approval/question flow remains visible and the agent waits for the answer. |
| Restart the app, then ask the agent to continue the same task. | Work continues with the same policy and no context-loading recap. |
| Ask explicitly for a detailed account of teammate coordination. | The agent provides the requested detail. |

## Change rules

1. Put a type in `packages/contracts` only when it crosses a process or application boundary.
2. Put a validation rule beside the contract when all consumers must use the same limit or syntax.
3. Keep provider-specific payloads inside the provider adapter. Translate them at ingestion.
4. Keep database schema changes in the schema module and add migration tests.
5. Keep Electron entry points small. New features use a service or a focused IPC input module.
6. Do not add a second linter or formatter. Biome and its repository-owned anti-slop plugins are the
   only repository lint and format tools.
7. Put renderer state in a domain context module inside that domain's feature directory,
   `src/renderer/src/features/<domain>/<domain>-context.tsx`, beside the logic, views and tests that
   read it, and place it by lifetime: state that belongs to one team server goes inside the keyed scope in
   `app-providers.tsx`, everything else above it. A server switch discards and rebuilds that scope,
   so it is the only per-server teardown there is - a signal on the wrong side of that boundary
   either survives a switch it should not or dies in one it should not, and no list of setters can
   fix it. A context reaches another one with `use*()` only downwards, in the nesting order of
   `app-providers.tsx`, or through a provider prop; a command that writes to several domains lives
   in a leaf context or a bridge component mounted under all of them. `window.openbot.*` is not a
   dependency. Cycles are rejected by `noImportCycles`, so an upward edge must be `import type`.
   Prefer one store per concern inside a context over a signal per field: a row of parallel signals
   is what lets a screen be loading, loaded, and errored at once.
8. Read those contexts from the smallest component that needs them. A pane calls the `use*()` of the
   domains it renders and nothing else; `WorkspaceShell` reads only what decides *which* pane
   renders, and passes a value down as a prop when two of them would otherwise derive it twice. A
   component that assembles another one's props is how the god controller grew back last time.
9. Do not add temporary compatibility paths without a removal condition and a test for that condition. Released Team API protocol adapters are permanent by default and follow the policy below.
10. Log through `@openbot/logging` (`ts-log` Logger), never bare `console.*` - Biome's `noConsole`
    enforces this in `src`, `scripts` and `packages`. The remote-desktop build recipe files listed in
    the `Require a recipe version bump` step of `.github/workflows/remote-desktop-runtime.yml` are
    exempt: any edit to them, cosmetic or not, forces `remoteDesktop.recipeVersion` up and a full
    native runtime rebuild, so their logging is frozen until the recipe changes for a real reason. Every line is timestamped, prefixed and
    secret-redacted, and redaction covers a serialized payload passed as one string, not only a
    structured param. `info` and above is written by default; `OPENBOT_LOG_LEVEL` lowers the
    threshold. Machine-readable stdout (piped JSON, tags, harness URLs) uses
    `process.stdout.write` with a `// Machine-readable:` comment instead. Dev automation
    (`scripts/dev-automation`, `bun run dev:automation`) drives the already-running dev app over its
    remote-debugging CDP port and never launches a second instance, seeds, or resets the dev profile.
    Because several worktrees run dev side by side, each instance publishes its worktree, profile,
    renderer port and debugging port to a registry in the per-user temporary directory
    (`scripts/dev-automation/instance-registry.ts`); automation resolves the record of the worktree
    it runs in, verifies the renderer port and the `window.openbot` preload bridge before driving a
    page, and refuses `click` or `type` on an instance it only inferred. A second registry beside it
    (`scripts/dev-automation/stack-registry.ts`) records every port and pid a whole dev stack holds,
    Storybook included, and `scripts/dev-automation/port-allocation.ts` serializes read, choose and
    publish behind one machine-wide lock: probing a port and binding it seconds later is a check
    followed by a use, so two runners starting together both used to win 5173 and the unsuffixed
    `OpenBot Dev` profile with it. Ownership of that lock is a generation rather than a path: taking
    it means creating the next numbered file with an exclusive create, so who owns it is decided by
    a step the kernel makes atomic and never by a delete. Once a lock path exists it stays, and nothing ever
    frees it: releasing replaces the contents with a released marker in one `rename` onto the same
    path, and a lock whose holder has died is superseded where it lies. An allocator asks for the
    highest generation it saw plus one, so anything that frees a path - deleting it, or renaming it
    aside - lets that number be handed out again beside a plan already made against it. A holder
    that is still running is never moved past, however long it has held it. Reading a registry is
    the same shape and holds to the same rule: a record whose processes are gone is filtered out of
    every read, so its ports are free from that moment, but the file is never deleted by the reader
    that judged it - the supervisor may have republished it with a detached child in between, and a
    sibling worktree on a newer branch writes records this checkout cannot parse at all.
    `bun run dev:forget` is what removes a record, because a developer asking for it is a decision
    rather than a guess. It drops the instance records of the stack it forgets, and a pid is not an
    identity: an instance record is stored under its pid, so the app that recycles one writes over
    the record of the app that had it. Each record dates itself, so the worktree and the recorded
    start time decide whose it is, and a live instance is never a dead stack's. `bun run dev:status` and `bun run dev:stop`
    (`scripts/dev-stack.ts`) read those pids instead of matching a process name, which is what makes
    stopping one worktree's stack leave the others alone. Every dev window stays
    reachable: `pages` lists the targets and `--page=<target-id|url-substring>` drives any of them, so
    the app window is the default rather than a limit. Page URLs reach the diagnostics and the
    snapshot document only through `describeTarget`.

SQLite migration history starts at the frozen version 8 compatibility baseline. Keep the baseline
schema unchanged, append every later migration in numeric order, and update the separate latest
schema used for new databases. Never remove or rewrite a migration that may have shipped.

At startup, chat recovery reads all saved provider sessions for each thread, including inactive
sessions from an upgrade or a provider change. It uses each session's provider and merges the
messages into SQLite without activating the old session. A failed read reports an error, keeps
the saved messages, and can be tried again when the provider connects or the app restarts.

## Team API compatibility boundary

Current remote connections use Team API protocol v3 over three ordered WebRTC DataChannels: `rpc`,
`events`, and `files`. A sandboxed hidden Chromium page owns each `RTCPeerConnection`. Electron main
uses a `MessagePort` and transfers binary data as `ArrayBuffer`. Signal carries SDP and ICE only.
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
Desktop window focus does not trigger an automatic account or directory check.
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

## Required verification

Run the narrowest relevant test, then `bun run lint` and `bun run typecheck`; both are cheap enough
to run whole, and CI owns the minutes-long suites. See [AGENTS.md, Checks](../AGENTS.md#checks)
for the division of labour and what each CI job covers.

The Storybook CI job builds all stories with `OPENBOT_STORYBOOK_CHECK=true`. This skips Solid's
automatic prop documentation analysis. The job checks compilation and does not publish its output.
Local Storybook keeps this analysis. Both paths use one Solid compiler plugin.

The browser smoke check also supports `--scenario=wait-deadlines`. These checks wait for the tab's
operation queue to clear before measuring a new deadline. A timed-out call can return while its
CDP commands still need to finish, and that cleanup is outside the next operation's deadline.

Each TypeScript project writes its own ignored `.tsbuildinfo` cache beside its configuration.
Each worktree starts with no cache. The first check creates these files; later checks reuse them
and check changed inputs. Delete the cache files to force fresh checks. A new CI checkout also
starts with no cache unless the CI job restores one. The aggregate commands keep all projects in
parallel. Project scopes and compiler worker settings stay the same.

Changes to packaging, native modules, or Electron security also require the applicable macOS and
Windows package verification commands. Live provider and team smoke tests use isolated temporary
data and are manual because they can require local credentials.

### Prompt-driven agent profiles

Users create and edit agent profiles by asking an agent in the normal desktop or mobile
conversation. `openbot.create_agent` creates a persistent teammate with instructions and a first
task; `openbot.update_profile` changes an existing agent's name, title, instructions, or generated
or custom avatar. `avatarPath` accepts a local PNG, JPEG, or WebP file up to 512 KB, with relative
paths resolved from the calling agent’s workspace. The agent uses its available tools to resize or
compress a copy when needed. OpenBot validates the prepared file before profile changes and copies
it into managed avatar storage. Generated avatar settings remove the custom image. Both run through
the existing agent service and validate arguments before changing state.
Codex and Grok receive the dynamic tool definitions; Claude exposes the same operations through
its SDK MCP bridge. `src/backend/openbot-tools.ts` owns the tool names, descriptions, and Zod
argument shapes used by both declarations. It reuses the profile, section, and routine schemas.
Claude uses the SDK’s `AskUserQuestion` flow instead of the `ask_user` MCP tool.
There is no separate prompt-generation button or review dialog.

Agents can organize teammates into flat sidebar sections through `list_sections`, `create_section`,
`rename_section`, `delete_section`, and `assign_agent_section`. Assignment accepts a null section
to ungroup an agent; deleting a section also ungroups its agents without deleting them. These tools
use the same `SidebarLayoutStore` as manual sidebar edits, including persistence, validation,
and change events delivered to desktop and connected clients.

Codex fixes dynamic tools at provider-session creation; resume does not update them. A local
`provider-toolsets` manifest records the tool fingerprint for each new Codex session. Sessions with
missing or outdated fingerprints are replaced before the next turn, using the existing history
handoff while retaining the public thread, agent identity, workspace, and stored conversation.
Unchanged fingerprints resume the existing session. Pending history handoffs are written before
the replacement is bound, reloaded after restart, and removed after a turn accepts the handoff.

The optional `agent-profile-generation` Team API endpoints remain available. They use a separate
provider client with tools restricted and validate drafts before returning them. Their save path
retains its recovery and retry guarantees:

A profile-creation marker is written before its workspace or agent row. Startup removes
uncommitted creations before mailbox initialization and queue draining, while a committed
retry receipt preserves the agent and its introduction. The existing sidebar reconciliation
removes assignments for recovered incomplete agents.

Reviewed instructions use the existing profile description. Profile saves coordinate
SQLite with the separately stored sidebar layout, rolling back section assignment
on failure. Updating an existing profile and its retry receipt shares a SQLite
transaction. Creation follows the existing workspace/initial-message flow with
cleanup on failure. Receipts make retries after a lost response return the saved
agent. This does not introduce a schema migration or alter released protocol codecs.

## Mobile product analytics

`apps/mobile/src/features/analytics` owns the React Native OpenPanel client, typed event allowlists,
account-scoped operations, the local SecureStore preference, and foreground/connection events.
Before session creation, it buffers at most 100 sanitized events in memory for 30 minutes from the
first buffered event. The next account claims this buffer; identify precedes ordered delivery with
original timestamps. Reconnects do not replay it. Expiry, opt-out, and process exit discard it.
Account changes invalidate prior operation scopes; the anonymous-to-account transition retains the
pairing scope so its completion can be recorded. Mobile uses a write-only client in the existing
Openbot OpenPanel project shared with desktop and the website.
Workspace command wrappers record outcomes once at the mobile caller; conversation availability is measured in
the visible chat view, including cached reads, not from background broadcasts. The host remains the only source of turn lifecycle
events. No Team API or database schema changes are required.

Only native production builds with mobile write credentials initialize the client, after the
preference is loaded. UI actions never await analytics transport. Account/consent generations
reject late results; ordered identity changes preserve attribution of already accepted events.
A final SDK filter replaces properties to remove SDK-added Android referrers and route paths.
The SDK's optional persistent queue and screen tracking are not enabled. Configuration, event
semantics and native verification steps are in [the mobile README](../apps/mobile/README.md#openpanel-product-analytics).

## Website analytics

Public website tracking lives in `apps/auth-api/src/lib/analytics.ts`. It runs only on the
production `openbot.run` hostname. Landing and invitation events carry a bounded
`source_platform`, the existing `acquisition_source` category, and a domain-only referrer.

A recognized `utm_source` tag takes precedence over the referring domain. Exact domain and
subdomain matches select known platforms; URL paths and substring matches do not. Unrecognized
platforms use `unknown`. No referral signal retains the coarse `direct` category, which does
not prove a visitor typed the address. Raw campaign tags are never transmitted.
See [PRIVACY.md](../PRIVACY.md) for the data boundary.

The OpenPanel Growth dashboard uses a session funnel from `landing_viewed` to
`landing_download_clicked`. A download click is not a completed download or installation.
Break down the funnel by `acquisition_source`, then `source_platform` once schema version 7
events reach OpenPanel. Historical events do not contain the new platform property.

For download-click reports, `platform` means the requested macOS, Windows, or Linux download;
`placement` means the button location. These properties exist only on the download step.
Use them to compare click counts, not as a shared visit-to-click funnel breakdown.
The invitation-page funnel is separate: `join_page_action` with `action=view` followed by
`action=download` or `action=open_app`.

### Managed provider updates

The main process offers provider versions pinned in `native-runtime.lock.json`. Each provider is
pinned for `darwin-arm64`, `linux-x64`, and `win32-x64`; a platform with no pinned artifact reports
that it is not supported instead of offering a download. An older managed installation is display
metadata until the pinned runtime passes the existing download and install checks. Runtime snapshots carry the previous version and an optional `availableVersion` through the
preload decoder. Cancellation and failure preserve the previous installation and its update offer.

Settings starts the shared renderer runtime store. The store announces each provider that gains an
offer as one notification, from an effect over both the runtime snapshot and the agent status,
because the two arrive separately and either one can complete an offer. An explicit update opens
the same notification; revisioned snapshots move it through progress, failure, retry, and
completion. Only the crossing into "update available" is announced, so a dismissed notification
stays dismissed until the offer changes. Closing the notification does not cancel the download,
and later reports do not reopen it. A refusal that reaches neither the download nor the report it
makes - an update started while a workspace on another computer is open - is put on that same
notification with a Retry, because the user pressed a button and the outcome belongs on screen.
Fresh provider downloads retain their existing flow. These actions apply only to the local desktop
host.

A CLI the user installed themselves is not managed, but it is still compared against the lock.
Each provider status row reports `cliSource`, and main passes the version of a `system` row to
`ProviderRuntimeManager.setSystemVersion`, which compares it against the pinned version exactly as
it compares a managed installation. The row and the notification therefore use the one update offer,
the one Update button, and one entry point in the runtime store, `startProviderUpdate`. One path
runs behind it, whoever owns the CLI: the download installs the pinned managed copy and
`updateProviderCli` activates it, and CLI resolution then prefers that copy to the system install,
which is left where it is. OpenBot never runs the CLI's own updater, so no version it offers depends
on another release channel. An explicit `OPENBOT_*_PATH` suppresses the offer, because that path
names the binary to run and the managed copy is not it. The owner comes from the last resolution of
the binary, not from the client that runs it, so a provider that is signed out still reports its own
install rather than reading as the managed copy. A failure keeps the reason the CLI gave, redacted,
in one error that goes to the provider row and to the caller - and on, through the Team API, to the
team's connected clients.

Every runtime the store reaches is on this computer: `window.openbot.providerRuntimes` addresses no
other one, while the agent status beside it describes whichever server is open. The store therefore
takes `isLocalServer`, and a workspace on another computer announces no offer and starts no update -
the same rule the provider row and the picker already follow. A server switch rebuilds that store,
so the version a user closed the notification on is kept by the notification module, which outlives
the switch: the offer is raised again on the way back only if the user never closed it.

Replacing the CLI is not a start, on either path: `#activateProviderClient` swaps the client of a
provider that has one, `#connect` connects one whose client is gone, and both skip
`onProvidersReady` for the replacement, because
that hook is restart recovery: it settles every unresolved delivery, and the other providers keep
running through the replacement, so a live turn would be recorded as `interrupted` - which
`MailboxStore.markTerminal` then refuses to correct. `onProviderResumed` schedules the deliveries
the replacement held back. The refusal record is written through one queue, because two providers
can finish an update at once and the older snapshot must not be renamed over the newer one.

The update replaces the binary under a running client. A provider that has an agent in a turn -
a delivery on its way to one, which holds no turn id yet, or a context compaction, whose
`turn/started` `ContextCompaction.claimTurn` takes away from the agent - therefore refuses the
command and tells the user to wait. No turn may start on that provider until the new client is ready: the drain
scheduler skips an agent whose provider reports `isReplacingCli`, before it can reschedule the
delivery, and `onProviderResumed` schedules the held deliveries when the replacement ends, after a
failure as well as after a success.

That updater decides for itself what the newest version is, and its release channel can name an
older one than the lock: `grok update` can report success and leave the CLI where it was. The IPC
handler therefore reports the version before and after the run to
`ProviderRuntimeManager.noteSystemCliUpdate`. An update that finishes on the version it started on
is the updater's answer: the manager records that pair of versions in `cli-update-refusals.json`
beside the managed runtimes, and drops the offer from `availableVersion`, so the row and the
notification stop offering an update that cannot happen. The record is kept against both the
installed and the pinned version, so a new pinned version is a new offer, and so is a CLI the user
moves by other means. The runtime store keeps the same answer in memory for the run that produced
it, only to settle the notification before the next snapshot arrives.

## Agent usage analytics

`AgentUsage` owns local numeric usage records, cumulative counter checkpoints, and activity counts.
Migration 15 adds these tables on both database creation paths. They do not reference conversation
projections: clearing a conversation must retain usage. Agent deletion removes usage, checkpoints,
activity, and related command receipts in its existing transaction.

The turn lifecycle accepts usage only for a provider session belonging to the agent. Codex totals
use durable session checkpoints; restored totals establish a baseline for pre-feature sessions.
Claude uses per-model query totals and a separate counter identity for each query process. ACP usage
is optional. Missing fields remain unknown. Completed assistant messages exclude commentary and tool
output. Only post-install messages enter activity counts.

`agent:get-analytics` and the capability-gated `GET /v1/agents/:agentId/analytics` return aggregates.
They are separate from provider account limits. A request names the agent, inclusive calendar dates,
and viewer time zone. The host groups records into calendar days in that zone. Date comparisons use
an inclusive start and exclusive next-day boundary; custom ranges are limited to 367 days. Desktop
names the host explicitly, and mobile binds reads to its authenticated active host. Every member of
that host team can read totals. The public web and Signal service store no usage records.

The Usage views show 7, 30, 90, or custom days, with 30 days as the default. Both expose exact daily
values beside the SVG charts. Cost is a USD API-equivalent estimate, not a subscription charge.
The bundled rates cite official sources and carry a verification date. Claude list-price estimates
come from SDK model usage; unknown or managed pricing is not treated as a list-price estimate.
Unknown models, missing cache data, and unresolvable context or cache-write pricing stay unpriced.
Tool and media fees are outside the estimate. Stored estimates retain their price basis.


### Host-wide Usage

Desktop opens Usage from the server context menu. It keeps the previous workspace mounted and
inert until Back, so conversation drafts and settings survive navigation. Agent settings opens
the same report with an agent filter. Host changes clear the filter and stale responses are rejected.

`host:get-analytics` and the optional `host-analytics` capability expose `GET /v1/analytics`.
The host queries its local usage tables once for the date range and optional agent filter; it does
not add per-agent API responses. The one pass groups by agent id beside day and model, so the
host-wide response carries per-agent rows that the client labels from the agent list it already
reads. The same pass also groups by day and provider, which is what lets the chart draw one area
per provider over a shared baseline; a cell carries only the token count and the cost estimate,
because those are the two measures the chart reads. Both arrays are on the host report only, which
is why the agent-scoped route, its codec and the mobile screen are unchanged. Session and turn identities include agent and provider. HTTP and
WebRTC use an explicit host analytics codec. Existing agent analytics and account limits keep their
contracts. All authenticated team members can read these aggregates; no additional analytics data
is stored by the account service or Signal service.

The desktop chart adapts Zaidan's chart and interactive area composition. The pinned
`solid-recharts` dependency has a Solid 2 compatibility patch and uses the application's single
Solid runtime. Chart colors use OpenBot tokens. Daily tables provide exact accessible values.

### OpenCode and ACP

`src/backend/acp-client.ts` owns ACP process transport, model discovery, session start/load,
streamed messages, permissions, tool bridging, and cancellation. `grok-client.ts` supplies xAI
login and billing hooks. The OpenCode driver starts `opencode acp` on the runtime OpenBot pins and
downloads, or on a CLI the user installed. Profile clients deny tool permissions.

OpenCode has no login step OpenBot can drive, because the account is one environment variable: a
spawn without `OPENCODE_API_KEY` lists the free OpenCode Zen models, and a spawn with one lists the
paid catalog. So `AcpAgentClient` derives `#signedIn` from the models `session/new` returns, not
from a credential, and a keyless OpenCode reports `available`. `AcpProviderOptions.extraEnv` is read
at every spawn, which is what lets a key saved in Settings reach the next process with no other
plumbing, and what carries `OPENCODE_DISABLE_AUTOUPDATE` to a managed install so the CLI cannot
update past the pin. `src/main/provider-credential-store.ts` holds that optional key, encrypted by
`safeStorage` in a `0o600` envelope under `userData`. Only a status (`missing`, `saved` or
`unreadable`) crosses IPC; no getter returns the key. A file the store cannot read does not stop
startup: OpenCode runs keyless, Settings reports the key as unreadable, and the file stays until the
user saves or removes a key. The store writes a change to disk before it changes memory, so a
failed write changes neither. `ProviderRuntime.changeProviderCredential` applies a key change inside
the provider's serialized connection command. It refuses a provider that is running a turn, holds
deliveries while it writes, and reports success only after a new process runs with the new key.

That one variable turns on two products: OpenCode reports OpenCode Zen and OpenCode Go as a single
catalog, on the separate endpoints `opencode.ai/zen/v1` and `opencode.ai/zen/go/v1`, and a Zen key
does not buy Go. So `CREDENTIAL_ONLY_MODEL_PREFIXES` in `src/backend/agent/provider-runtime.ts`
drops the `opencode-go/` models from `#refreshModelCatalog` while OpenBot is the one supplying the
key; with no key stored those models can only come from the user's own OpenCode sign-in, which does
buy them. Neither `/models` endpoint authenticates, so entitlement cannot be read back and the
split is a product rule rather than a check.

`PREFERRED_MODEL_ORDER` in the same pass reorders that catalog, because a provider with no
`defaultProviderModel` runs the first model of its list and OpenCode reports the third-party
services the user signed in to before its own — so the fallback used to pick a model behind a token
OpenBot can neither see nor refresh. `opencodeModelRank` sorts free models first with Muse ahead of
the rest, then OpenCode's own paid models, then everything behind a separate sign-in. The sort is
stable, so the CLI's order survives inside one tier.

Free means a display name ending in "Free": `model/list` carries no price and neither Zen endpoint
authenticates, so the name is the only signal. `isFreeOpencodeModelName` in
`packages/contracts/src/agent-providers.ts` is shared with the picker badge in
`src/renderer/src/components/provider-model-options.ts`, so a badge and a default cannot disagree
about what costs money.
Provider session IDs remain in `projection_provider_sessions`; migration 17 adds OpenCode while
preserving turn links. Provider switches keep the same agent, workspace, and local thread.

Team API v4 has its own frozen provider-aware schema and adapters. Versions 1–3 remain registered
with their released provider vocabulary. The host filters OpenCode agents, models, status,
sidebar references, and runtime events before encoding an older client's response. Requests for
an OpenCode agent from those clients return 404. WebRTC keeps its v2 frame transport and selects
the v4 application codec when the peer advertises the `opencode` capability.

### Desktop server notifications

Each desktop profile stores muted server IDs in `servers.json`. `RemoteServerStore` saves a
mute change before publishing it. These preferences survive restart, re-login, and host-list
reconciliation. The server context menu controls mute for local and remote servers.

`renderer-forwarders.ts` continues to deliver live events for muted servers, but suppresses
system notifications. Remote notification content uses the source server's agent list. Both
server mute and per-agent notification settings apply. Unread state is unchanged. Mobile does
not yet deliver system notifications; mute settings are not synchronized between devices.

## Shared desktop channel chats

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
