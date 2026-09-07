# OpenBot architecture

OpenBot is a Bun workspace with one packaged desktop application, one cloud application, and small
packages for code that has more than one consumer.

## Workspace map

```text
apps/
  auth-api/          Cloudflare Worker, account login, remote membership, and connection tickets
packages/
  contracts/         Process and network boundary types, limits, and pure validation
  logging/           ts-log Logger interface plus the redacting console/file implementation
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

## State ownership

- `openbot.db` is the source of truth for OpenBot agents, conversations, queues, reactions,
  attachments, and provider-session bindings.
- `~/.codex`, `~/.claude`, and `~/.grok` are provider-owned login and resume state. They are not OpenBot
  conversation storage.
- D1 is the source of truth for central accounts, remote membership, invitations, and logical sessions.
- A local team host owns conversations, files, agents, and the local member projection used by Team API.
- Renderer signals and stores are projections for the current screen only. They are not durable
  state, and one concern is one record - a row of parallel signals over its fields lets a screen
  hold states the product does not have.

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
    page, and refuses `click` or `type` on an instance it only inferred. Every dev window stays
    reachable: `pages` lists the targets and `--page=<target-id|url-substring>` drives any of them, so
    the app window is the default rather than a limit. Page URLs reach the diagnostics and the
    snapshot document only through `describeTarget`.

SQLite migration history starts at the frozen version 8 compatibility baseline. Keep the baseline
schema unchanged, append every later migration in numeric order, and update the separate latest
schema used for new databases. Never remove or rewrite a migration that may have shipped.

## Team API compatibility boundary

Current remote connections use Team API protocol v3 over three ordered WebRTC DataChannels: `rpc`,
`events`, and `files`. A sandboxed hidden Chromium page owns each `RTCPeerConnection`. Electron main
uses a `MessagePort` and transfers binary data as `ArrayBuffer`. Signal carries SDP and ICE only.
OpenBot Mobile uses the same ticket, authentication transcript, framing, RPC codec, and event stream.
In Expo Go, an Expo DOM component owns the browser `RTCPeerConnection` inside a hidden WebView and
passes only serializable, validated commands and events to the native React UI; no native WebRTC
module or development build is required.
Mobile server labels in the drawer and connection settings describe the authenticated application
connection, not membership or Signal presence. Only the selected server has a live connection;
unselected/unobserved servers show Unknown. Switching servers or backgrounding clears the previous
status. Connecting becomes Online after compatibility and workspace synchronization succeed;
transport failures and reconnect attempts show Offline, and protocol failures show Connection error.
The existing RTC connection updates and recovery controller are the source of truth; the indicator
adds no polling or health requests. Foreground resume, invite selection and manual refresh reuse
that controller. RTC disconnection/failure events clear Online and drive recovery after network loss.
The native/DOM mailbox carries concurrent commands by ID. Switching or disconnecting cancels
pending callers immediately; peer generations reject late callbacks from a superseded host.
The persisted hosting preference is restored on startup in both the normal desktop and the
development host. Starting the development HTTP API alone does not publish WebRTC; Mobile Connect
needs the published host. The separate development test-client role never auto-publishes.
Mobile Connect tickets and QR codes bind the started host ID and SHA-256 public-key fingerprint.
Mobile verifies that binding at redemption and against the directory, pins the key, and selects
that host rather than the first account-owned desktop. Legacy unbound QR codes require regeneration.
Conversation read cursors belong to a team member and are shared across that member's devices.
Advancing a cursor emits a conversation invalidation without the reader's identity or cursor;
clients reload their own read state even when the conversation content revision is unchanged.
Mobile acknowledges rendered replies only in the foreground, focused chat at the latest messages.
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
the account API on notification, foreground entry, or Signal reconnection, with no periodic polling.
Older Signal clients ignore this optional event. API and Signal both need the event support for push;
foreground refresh remains the fallback when Signal is unavailable. Unchanged responses do not
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
to run whole, and CI owns the minutes-long suites. See `AGENTS.md` "CI owns the minutes-long suites"
for the division of labour and what each CI job covers.
Changes to packaging, native modules, or Electron security also require the applicable macOS and
Windows package verification commands. Live provider and team smoke tests use isolated temporary
data and are manual because they can require local credentials.

### Prompt-driven agent profiles

Users create and edit agent profiles by asking an agent in the normal desktop or mobile
conversation. `openbot.create_agent` creates a persistent teammate with instructions and a first
task; `openbot.update_profile` changes an existing agent's name, title, instructions, or generated
avatar. Both run through the existing agent service and validate arguments before changing state.
Codex and Grok receive the dynamic tool definitions; Claude exposes the same operations through
its SDK MCP bridge. There is no separate prompt-generation button or review dialog.

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
