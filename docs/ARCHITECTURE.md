# OpenBot architecture

OpenBot is a Bun workspace with desktop, browser, and mobile applications, two Cloudflare Workers,
a self-hosted Signal service, and shared packages.

## Workspace map

```text
apps/
  auth-api/          Public web and /app browser entry, accounts, memberships, connection tickets, and billing
  mobile/            Expo React Native client for remote team hosts
  site-router/       Cloudflare Worker that serves published sites from private R2 storage
  slack-app/         Slack CLI projects with the OpenBot Slack app manifests (production, development)
packages/
  ui/                Shared SolidJS controls and primitive styles for desktop, web, and Storybook
  brand/             Shared logos, avatars, and design tokens
  contracts/         Process and network boundary types, limits, and pure validation
  i18n/              Message catalogs, translate and format functions for desktop, shared UI and mobile
  logging/           ts-log Logger interface plus the redacting console/file implementation
  team-client/       Shared team connection, recovery, WebRTC framing, Dynamic Island state, and routine schedules
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
tools/               Biome GritQL rules, the UI foundation check, and the vitest sequencer
.agents/skills/      Task instructions for coding agents, such as release and smoke checks
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
- The auth API server cannot import desktop implementation files. Browser-only route composition
  can import renderer UI through the explicit preview and web aliases. These entry points do not
  load Electron, preload, setup, or updater providers.

`noRestrictedImports` overrides in `biome.json` enforce the import rules above: renderer and shared
UI to main, backend, and preload; main, backend, and preload to renderer; contracts to Electron,
SolidJS, provider, Cloudflare, and application code; and the account server to desktop code.
`noNodejsModules` keeps Node.js out of contracts and the team client.

## Browser client

`apps/auth-api` serves `/app`. Its lazy route mounts the interactive client after browser startup.
`src/renderer/src/features/web-client` owns the browser composition and its typed
`WebWorkspaceRuntime` interface. It mounts the existing account login, server rail, sidebar,
account dock, and full conversation view. `ConversationRuntime` routes host actions through
the browser connection; its desktop default is the preload API. The desktop `WorkspaceShell` and the
web client draw the same `WorkspaceFrame` under `LayoutProvider`, so the rail geometry, the sidebar
resizer and compact modes, the compatibility screen, and the usage report slot are the same on both.
The overlays that both clients raise - join, marketplace, shared agent, server settings, global
search and channel creation - are prop-driven views in `WorkspaceOverlayViews.tsx`.
`WorkspaceOverlays` fills them from the desktop contexts, and the web client fills them from its
host connection, so what an overlay decides from its server is decided in one place.
The web client gives `PlatformProvider` a fixed `appInfo` in place of the main-process answer.
There is no separate web dashboard.
Small screens switch between the same conversation and workspace components. The shared browser
panel receives the web live-view runtime and hides unsupported native controls. `BrowserLiveView`
accepts an explicit runtime; desktop and the existing preview still default to the preload-compatible
API. The web Storybook runtime uses
`preview/mock-openbot.ts` through `preview/mock-web-runtime.ts`.

The browser runtime uses `packages/team-client` for the directory, authenticated WebRTC peer,
Signal recovery, file transfers, and browser-view streams. The stream codec lives in contracts;
the old main-process import re-exports that codec without changing its wire format. Account
requests use a closed list of `/api/browser/*` operations. They cannot carry chat requests.
Browser tickets and session termination require the same account-session hash that created the
remote session. Existing bearer-token endpoints retain their behavior. The browser edits the
account's name, avatar, and sessions through `v1/me/profile`, `v1/me/avatar`, and `v1/me/sessions`,
which call the same `AuthService` methods and avatar storage (`avatar-storage.ts`) as the bearer
routes. The avatar upload is the one write that is not JSON; the origin and `X-OpenBot-Browser`
checks still apply. `web-account.ts` makes these calls, and the shared `AccountProfilePanel` shows
them in the conversation's right panel.

An owner or admin gets the host controls of a desktop remote admin. Shared components keep their
desktop port as the default and take injected calls: `web-server-settings.ts` gives
`ServerSettingsModal` the host identity, MCP, and storage routes through
`@openbot/team-client/team-admin-requests`, and member and invitation calls through the closed
`/api/browser/*` list. The Worker applies the same `RemoteControlPlane` role checks as the bearer
routes. A member or role change revokes every session on the host; the browser reconnects once when
the directory still lists the host. `ConversationRuntime.admin` carries the skills and shared-table
calls to the agent settings panel, which shows only Skills and Tables in the browser. Memories,
routines, and files stay on the desktop. The auto-approve switch writes through the agent-admin
route. `web-marketplace.ts` gives `MarketplaceModal` its calls: the public catalog routes of
the account service that serves `/app` (`@openbot/team-client/marketplace-catalog`), and installs on
the host over `skills-admin-v1`, `agent-install-v1`, `agent-update-v1`, and `mcp-servers-v1`. Try skill and a plugin
prompt add a line to the agent's draft, as on desktop. A shared agent page also links
`/app?agent=<id>`: `WebApp` reads the id once, removes the query, and keeps it through sign-in;
`AgentTemplateInstall` then shows the preview, and the host adds the agent over `agent-install-v1`.
A browser submits nothing to the marketplace. It can publish a host agent's share link over
`agent-publish-v1`, in `ConversationRuntime.admin.agentTemplates`: the host builds the template,
checks it for secrets and publishes it with the account signed in on the host; the browser draws only
the share card from the preview. An agent that the host added from a
listing gets Update when the host serves `agent-update-v1`; the host downloads the current version.
`web-provider-admin.ts` answers the desktop `providerAdmin` group over the `providers-v1` routes, so
the Providers section of `ServerSettingsModal` uses the same runtime, key, custom provider, and code
sign-in logic (`provider-code-login.ts`, `ProviderSettingsSection.tsx`) as the desktop app. On
desktop the section shows the providers of the active server only, because provider state exists
only for that server; for another server it offers to switch. The
browser applies host `status` events, and reads the status every 3 seconds while a code sign-in waits.
A provider key stays in the dialog input until it is sent to the host.

Browser sign-in, account reads, and connection tickets are always available. No host or D1
migration is needed. See [web client delivery](web-client.md) for the seven review scopes, local
commands, and release checks.

Browser chat pages, drafts, file bytes, and chat visibility preferences stay in memory. A protected
cookie holds the account credential. Local storage holds account-scoped trusted host public keys,
the shared file panel's width, and for each account and host the pinned item ids, collapsed section
ids and selected channel id, not chat content. The channel UI takes a `ChannelsPort` runtime; its
desktop default is the preload API. A Web Lock permits one live tab per account
and host because the existing control plane reuses that credential's logical host session.
Host switches discard the prior host's chat state. Temporary connection loss keeps drafts; a
failed send stays in the chat and is never sent again on its own. BroadcastChannel, account
checks on focus, and signed session invalidation clear access when a session ends.

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
- `~/.codex`, `~/.claude`, `~/.grok`, and `~/.gemini` are provider-owned login and resume state. They are not OpenBot
  conversation storage.
- D1 is the source of truth for central accounts, remote membership, invitations, and logical sessions.
- Stripe is the source of truth for paid plans. D1 `billing_subscriptions` is a copy that the Stripe
  webhook keeps current; see [Billing](#billing).
- A local team host owns conversations, files, agents, and the local member projection used by Team API.
- `openbot-approval-automation-v1.json` holds Turbo mode and the agents granted "Always allow". It
  belongs to the computer that runs the agent and never crosses the Team API, whose released
  adapters freeze an approval response to `accept` or `decline`: a remote host that has automation
  on answers its own approvals, so they never reach a client, and a client cannot grant one on a
  remote host's behalf. `AttentionRegistry` reads it at each approval, including hosted-site
  publishing, replacement and deletion. Site validation, ownership checks and activity markers
  still apply. Questions and browser takeovers remain interactive.
- `browser-tabs.json` is the embedded browser's own durable state, outside `openbot.db` and outside the
  migration runner. It is versioned in the file (`v1` predates the per-tab `BrowserEnvironment`, `v2`
  carries it) and always rewritten as the current version, so a downgrade reads a file it does not know.
  Nothing copies it first, so `src/backend/browser-state.ts` re-validates every bound it reads rather
  than trusting it: a tab whose environment fails validation is still returned, without that
  environment, because losing the user's open tab is worse than losing an emulated viewport.
- `~/OpenBot/Shared/Data/agent-data.db` is one SQLite file that holds every table the agents create
  for themselves, outside `openbot.db` and outside the migration runner. One file gives the agents
  one namespace and lets them join across each other's tables. Every agent can read and write every
  table; the `openbot_metadata` table records the agent that created each one, and that owner is the
  only agent allowed to drop or alter it. SQLite's own authorizer refuses the other cases, so the
  rule does not depend on reading the model's SQL. The agents own these schemas, so nothing copies
  or migrates them before a release, and a table stays when the agent that made it is deleted. The
  user deletes one from agent settings, which is the only way to remove a table whose owner is gone.
  The guidance the agents read ships as the managed skill `resources/managed-skills/openbot-data`,
  beside site hosting and the skill creator, so the always-on prompt only names the tools.
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
Website popups are adopted into managed `WebContentsView` tabs through Electron's window creation
hook. Native guests retain their opener, request body, and shared browser session. Local tab and
agent tool results expose `openerTabId` while that relationship is live. Independent `noopener`
tabs survive parent closure; dependent popups close with the parent. Closing a popup returns to its
opener. Saved popup URLs omit OAuth callback credentials. Popup state is not restored as a live
JavaScript relationship after an app restart.
Connected pages in a native opener group can retain references to each other's documents, including
a document that received a secret. The browser blocks that access between sites, so a secure input
card is available in a connected tab only when no frame in another live connected tab has the
secret's site. The host checks this when the card opens and again before the fill; otherwise the tab
requires human takeover. The site check uses the last two host labels, which can refuse two sites
under one public suffix but cannot allow one site. Independent tabs remain eligible for secure input. Account selection without secret entry remains automated.
Agents use `list_tabs` after sign-in actions and inspect the new tab before continuing. Secure input
and takeover still handle passwords, codes, CAPTCHA, and passkeys. Blocked requests produce a
reason without including authentication URLs or request data.
Agent instructions keep the viewport stable during sign-in and require fresh targets after page
changes or covered-target errors. X Google sign-in starts on the landing page after cookie consent.
X can retain a Google callback for a removed login dialog and report `Input2SSO: Unsupported provider`.
For that error in the current attempt, agents may reload the signed-out landing page and retry once,
then verify authenticated navigation. This recovery does not run during secure handoff or discard
non-login work. The host does not rewrite site scripts or weaken cross-origin security policies.
Input dispatch runs inside those checks and queues. Upload staging also uses the shared parser before
it checks local file access.

### Tab lifetime

The agent decides when a tab closes. Nothing closes a tab when a turn ends: `close_tab` is the only
cleanup path, and the prompt asks the agent to use it once a task no longer needs the tab. A tab
therefore outlives its turn by design, which is what lets the next turn in the same thread carry on in
the page the last one left, and what lets the user read the result afterwards.

There is no user-owned tab. A tab carries `ownerThreadId` and `ownerAgentId`, and an agent may read
and close any tab in its own thread, including one the user opened there. The one hard block is a
takeover: while the user holds a tab, no agent tool touches it. That is enforced in
`BrowserHost.#requireToolTab`, which is the lowest point every tab-bearing tool passes through, so it
holds for callers that never reach `AgentService` -- the view gateway and remote hosts. The agent-wide
refusal in `AgentService` stays beside it rather than being folded in: it also covers `open` and
`list_tabs`, which name no tab, and it answers with a refusal instead of an error.

| Event | Tabs |
| --- | --- |
| Turn succeeds | Stay open unless the agent called `close_tab`. |
| Cancelled, interrupted, or failed | Stay open. Completion clears the control session only. |
| Retry | Same thread and agent, so the same tabs are still reachable. |
| Restart | Restored from the browser's own state file. |
| Idle 30 min (5 min when memory is low) | Stays open, but its page unloads. The next use loads the page again. |
| Agent deleted | That agent's tabs are closed, including a legacy tab holding only its thread id. |
| Takeover held | No agent tool touches that tab, `close_tab` included. |

Deleting an agent is the one sweep, and it exists because those tabs are otherwise unreachable: no
agent passes the owner check for them, and the renderer lists tabs per agent, so they would hold a
view the user cannot see to close, across restarts. Closing is idempotent -- `close()` returns early
on an id it does not hold -- and tab ids are UUIDs with no reorder feature at any layer, so a stale id
can never name a tab that took its place.

A member on a remote server cannot see the host's tab, because the tab is a native view on the host's
own screen. `browser-view-gateway.ts` answers that with a session and a websocket: `BrowserHost`
streams the tab through CDP, and the gateway sends each frame as bytes and dispatches the pointer and
key input that comes back, in fractions of the last frame, through the same access checks. Frames stay
outside the per-tab operation queue, so watching never delays a tool call. `browser-view-client.ts` is
the client half, and it reuses the Remote Desktop websocket tunnel rather than adding a WebRTC channel.
The `browser-view` capability says whether a host has both.

## Computer Use

Computer Use is `cua-driver`, a third-party MIT binary, and OpenBot owns how it runs.
`cua-driver-runtime.ts` in the main process starts one long-lived `serve` daemon and holds it; each
provider CLI spawns its own short-lived `cua-driver mcp --socket` proxy against that daemon. All
screen capture, accessibility reads, and input posting happen inside the daemon, so the proxy's own
identity does not matter.

The daemon is spawned directly, and never through `open(1)` or `NSWorkspace`. macOS finds the
responsible process by walking up the launch chain, so a direct spawn puts OpenBot at the top of it
and the user grants Screen Recording and Accessibility to OpenBot rather than to somebody else's
helper. `CUA_DRIVER_EMBEDDED=1` tells the driver to stay on that path instead of relaunching itself
as its own application. Anything that launches the daemon another way breaks the attribution, which
is the reason the earlier Codex helper was replaced.

Startup calls `warmUp()`, which reads the state once and keeps the daemon only when both grants are
there. A user who granted them keeps the tools after a restart, and a remote request or a scheduled
task — neither of which opens a window — reaches them too. A user who granted nothing keeps no
process, and no prompt is raised either way: only using the driver asks for a grant. Every other
start is lazy, on a state read from the panel.

The control socket lives in the private per-user runtime directory, mode `0o700`, not in `/tmp`:
whoever reaches it can drive the whole desktop. It cannot live under `userData`, because
`sockaddr_un.sun_path` holds 104 bytes on macOS and an isolated development profile spends most of
them on the worktree hash. Windows uses a named pipe, which has no such limit; its name is random,
because Windows lets a second process add an instance to a name it can guess, and it is kept in the
profile so that it is random once rather than once per launch. The endpoint has to hold still: it
reaches each proxy as an argument, and the arguments are folded into the stored Codex tool
fingerprint, so a name that moves at each launch replaces every session after a restart. The command
has to hold still for the same reason: the packaged Linux build is an AppImage, whose resources are
mounted somewhere else at each launch, so there the proxies are given a link below the profile that
the runtime points at this run's driver.

One MCP entry reaches every provider. `CuaDriverRuntime.mcpServerConfig()` returns a config only
while the daemon runs, and `AgentService.enabledMcpServers()` appends it, which is the one function
Codex, Claude, and ACP all read. Two properties keep it there: the name is not in
`RESERVED_MCP_SERVER_NAMES`, which is a drop filter rather than a marker, and `workingDirectory`
stays empty, because ACP has no field for one and Codex accepts none, so an entry with one would
vanish for two providers with no error. Codex staleness needs no separate signal, because
`toolFingerprint` already folds the MCP entries and a changed fingerprint forces a replacement
session. `onMcpServerChanged` is what refreshes the agent runtimes, which deactivates every
stored provider session: the next turn starts a new one, which keeps the public thread and loses
what the provider held privately. So it reports two moments only — the entry appearing on a start a
user asked for, and the daemon dying under OpenBot. It is quiet for a grant given while the daemon
serves, which changes the state and not the tool set; for the startup warm-up, which settles the
entry the stored sessions already had; and for the stop at teardown, which happens at order 55,
before the agent service at 110, and would otherwise deactivate on every quit the sessions the next
run is meant to resume.

`capabilities.computerUse` is pushed by main from the daemon's own permission answer. It is no
longer probed from Codex `plugin/list`, which is why the capability now reports the same state for
every provider.

The driver is packaged, not downloaded on demand, so it is pinned in `native-runtime.lock.json` like
the other native runtimes rather than managed like a provider CLI. The pinned file list is an
allowlist: `scripts/install-cua-driver.ts` copies only the named paths and checks each digest, so an
upstream layout change fails the build instead of shipping a surprise file. Each installer carries
only its own target. On macOS `mac.signIgnore` keeps the vendor's Developer ID signature, because
re-signing under OpenBot's inherited entitlements would drop the Automation entitlement the driver
needs. A packaged build reads the copy under `resources/cua-driver` and nothing else, because the release
is pinned and signed against that build and an environment variable must not decide which program
drives the user's desktop; a release without the binary reports no driver. In a checkout
`resolveCuaDriver` also reads an override, an install directory and `PATH`, so a developer can point
`OPENBOT_CUA_DRIVER_PATH` at another build.

OpenBot draws the agent cursor in its own per-display overlays for every display layout. The
runtime starts `serve` with `--no-overlay`. The driver's overlay covers only the main display and
cannot follow a display connected after startup. Keeping cursor ownership in OpenBot lets the
highlight controller add, resize, and remove display overlays without restarting the daemon or
changing provider sessions.

Because the driver draws no cursor, its motion styles do not apply. The renderer plays the driver's
`adaptive` style itself (`agent-cursor-motion.ts`, a port of the driver's `trajectory.rs`): a Fitts
min-jerk glide, or a wide swoop for a move over 900 points. The tap does not delay a request, so the
cursor shows where an action went, from 180 ms to about 1.1 s after the driver acts.

Every copy OpenBot starts gets `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and
`CUA_DRIVER_RS_UPDATE_CHECK=0`. OpenBot ships the driver, so its vendor analytics are not something
a user chose, and OpenBot pins the version, so a release check could only offer an update OpenBot
would refuse.

## Local script runs

`src/main/automation-server.ts` is a loopback HTTP listener through which a local script runs a
routine of an agent that allows it. [docs/automation.md](automation.md) has the routes and the
commands. The listener runs only while at least one agent has `allowAutomation`, and binds
`127.0.0.1` on a free port. It writes the URL and a new bearer token to `<userData>/automation/`
(folder `0700`, files `0600`) and deletes them when it stops. It refuses any request with an
`Origin` header or a foreign `Host` before it checks the token, so a web page cannot reach it.

A run is a manual routine run with the payload after the instruction, so no Team API protocol, run
kind or sender changes. The payload is in the run row, and `resumePendingRuns` sends it again after a
crash. The flag is in `agent_json` and needs no migration; a profile without it is off. Only the user
changes it, on the computer that runs the agent: the Team API parser and the agent profile tools do
not accept it, the remote IPC branch refuses it, and duplication does not copy it. When the flag is
on, the developer instructions name the two file paths, never the token.

## Provider CLI updates

The runtime manager offers the latest upstream release of each provider CLI. It checks at startup,
every hour, and when the user selects `Check for updates` (`provider-runtime-releases.ts`): GitHub
`releases/latest` for Codex, the npm `latest` tag for Claude, OpenCode and Cline, `x.ai/cli/stable`
for Grok, and the ACP registry entries `antigravity-acp` for Gemini and `cursor` for Cursor. The version in `native-runtime.lock.json` is what a first install uses before a check has
answered, and Bun, which is a tool runtime and not a provider, stays on it.

Every upstream download is checked against its source's own hash: the GitHub asset `digest` for
Codex and npm `dist.integrity` for Claude, OpenCode and Cline. x.ai and the ACP registry publish no hash,
so a Grok, Gemini or Cursor release is trusted on TLS alone. A Gemini release must stay on
`dl.google.com/agy-extensions/releases` and keep the pinned command name. A Cursor release must use
the pinned `downloads.cursor.com/lab` path for its target, with a build that starts with the
registry date, and keep the pinned command. An upstream install writes `openbot-install.json` with the SHA-256 of each
file it installed, and every start verifies that record and the binary's `--version` before the
install is used. The newest version in the store that verifies is the one that runs.

`provider-runtime-blocklist.json` on `main` names versions no installation may offer. It stops a
broken upstream release without an OpenBot release. It suppresses an offer only: it does not remove
a version a user already installed. A list that cannot be read blocks nothing.

The provider runtime holds new turns while it installs and activates that managed executable. It
keeps the previous client until the candidate is ready; activation failure removes the rejected
artifact and preserves the old runtime, so a release that does not start leaves the last working CLI
in use. Download status stays `finishing` until activation succeeds.

CLI resolution prefers an explicit `OPENBOT_*_PATH`, then the installed managed copy, then an
automatically discovered system CLI. Updates never run the system CLI's updater. An explicit path
suppresses managed update offers. Startup uses the same selection and reads the executable's version.

Installed runtimes live in one store per computer, `appData/OpenBot/provider-runtimes`, which is the
path the packaged app always used: its `userData` is `appData/OpenBot`. Development profiles differ
per renderer port and per `--isolated` worktree, so a store inside `userData` started empty in each
one, fell back to the user's own CLI, and offered and downloaded the managed copy again. An explicit
`--user-data-dir` still keeps its own store, so automation and packaged smoke checks stay
self-contained. Partial downloads stay in the profile: two instances appending to one `.partial`
would interleave their bytes.

Several instances can therefore write to one store, and they do not all carry this manager: a
released build sweeps every `.installing-` directory it finds when it starts, whatever its age and
whoever is filling it, so this build stages under `.staging-` and keeps the older prefix only to
collect what those builds abandon.

Installing a version is idempotent, so a commit that finds the destination occupied verifies
it and adopts it instead of replacing it, and only a destination that fails verification is moved
aside. That replacement is claimed first, with a lock directory beside the staging ones. The claim
is built away from the path, with the name of its owner already inside it, and moved onto the path
in one step, which the filesystem grants to one instance at a time; the path therefore never exists
without naming an owner. That is what makes age evidence: a claim reads old only when the instance
that made it is gone, never because a live one is part-way through making it. Whoever holds the
claim reads the destination again, so a copy a sibling committed in the meantime is adopted and
never moved, and reads what it moved aside once more before replacing it: neither the claim nor the
reading before the move is a promise about the moment of the move, so a runtime that verifies goes
back where it was found and is adopted. Nothing that verifies is ever replaced. An install that
cannot be read back after it is committed is taken away the same way, and for the same reason: it
is moved first, read where nothing else can reach it, and put back if it verifies, because the
reading that rejected it can have failed only because a sibling was replacing the path as it ran. A claim as old as an abandoned stage is recovered by moving it away and reading who it
names: the rename is atomic, so what it moved is that instance's alone to read, and only the claim
whose name was read is the abandoned one. The name is read before the age, so the two cannot come
from different directories: a claim on the path is only ever replaced by a newer one, so an age that
reads old belongs to the directory the name came from, or to one it already replaced. A claim made in between belongs to an instance that recovered the
path first, and the instance that moved it takes nothing. The holder reads the claim again
immediately before it moves anything and releases it only while it is still the one that attempt
made, so an instance that lost its claim stops at the destination rather than after it. The sweep
leaves claims alone: it holds none itself, and would otherwise be one more unsynchronised writer of
the path the claim exists to serialise.

One thing the store cannot defend is an installed version, while released builds still carry the
manager this one replaces: their collector keeps the version they pin and the highest other one, and
deletes the rest whenever they start, reading no timestamps. A development instance running a
version in between loses it and downloads it again. The alternative -- a store of its own, filled by
copying every verified runtime across -- would keep a second copy of each CLI on every computer for
as long as both managers exist, which is the cost this store was made to remove, and the exposure
ends with the first release that carries the age rule.

An update that finds the version already in the store skips the transfer, not the activation: the
agent service has to be given the executable either way. Staging directories carry the pid and a
random suffix and are swept by age, never by name, so a sibling's install is not collected while it
runs. The manager stamps each version it takes into use -- the pinned one it verified, and the older
one it falls back to until the pinned one arrives -- and collection keeps anything stamped within a
month, so a version another instance or another
worktree's pin still runs is not removed; a collection that fails, as it does on Windows for an open
binary, never stops startup.

### Managed provider updates

The main process offers the version that the section above selects. The lock pins each provider
for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and `win32-x64`; a platform with no pinned artifact reports
that it is not supported instead of offering a download. An older managed installation is display
metadata until the offered runtime passes the existing download and install checks. Runtime snapshots carry the previous version and an optional `availableVersion` through the
preload decoder. Cancellation and failure preserve the previous installation and its update offer.

`ProvidersProvider` starts the shared renderer runtime store for the active server. The store
announces each provider that gains an offer as one notification, from an effect over both the
runtime snapshot and the agent status, because the two arrive separately and either one can complete an offer. An explicit update opens
the same notification; revisioned snapshots move it through progress, failure, retry, and
completion. Only the crossing into "update available" is announced, so a dismissed notification
stays dismissed until the offer changes. Closing the notification does not cancel the download,
and later reports do not reopen it. A refusal that reaches neither the download nor the report it
makes - an update started while a workspace on another computer is open - is put on that same
notification with a Retry, because the user pressed a button and the outcome belongs on screen.
Fresh provider downloads retain their existing flow. These actions apply only to the local desktop
host.

A CLI the user installed themselves is not managed, but it still gets the update offer.
Each provider status row reports `cliSource`, and main passes the version of a `system` row to
`ProviderRuntimeManager.setSystemVersion`, which compares it against the offered version exactly as
it compares a managed installation. The row and the notification therefore use the one update offer,
the one Update button, and one entry point in the runtime store, `startProviderUpdate`. One path
runs behind it, whoever owns the CLI: the download installs the managed copy and
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
the replacement held back.

The update replaces the binary under a running client. A provider that has an agent in a turn -
a delivery on its way to one, which holds no turn id yet, or a context compaction, whose
`turn/started` `ContextCompaction.claimTurn` takes away from the agent - therefore refuses the
command and tells the user to wait. No turn may start on that provider until the new client is ready: the drain
scheduler skips an agent whose provider reports `isReplacingCli`, before it can reschedule the
delivery, and `onProviderResumed` schedules the held deliveries when the replacement ends, after a
failure as well as after a success.

## Agent communication policy

The shared developer instructions keep routine teammate exchanges internal by default. Agents
should start or resume work without narrating setup, context loading, discovery, or readiness.
Progress updates focus on meaningful outcomes, completed work, material changes, blockers, failures,
and required user input or approval. Delegated work still needs an explicit reply to the requesting
teammate; acknowledgements must not become loops. Relevant findings belong in the task result, and
the user can ask for a detailed coordination report.

An agent does not refuse a task, or say that it has no access to a service, before it tries each
path. When the task is outside its profile, or names a service that a teammate may own, it calls
`openbot.list_agents` first and delegates to a teammate whose name, title or description covers
the work. In a channel task it delegates only to a channel member. MCP servers are host-global, so
a specialist teammate differs only by its profile, skills and memories. Otherwise the agent uses its
connected MCP servers, its skills, the embedded browser and Computer Use.

A sign-in page does not stop it: it calls `openbot_browser.request_takeover`. The request shows in
the agent's conversation, and in the dynamic island when the agent's notifications are on, also for
delegated work. A routine run reports the sign-in instead, because nobody may answer; a requester in
a routine run says so in the delegated message. The tool returns only after the user answers, which
can take minutes. The end of the turn cancels the request, so the agent keeps waiting for the result,
also when the provider returns control while the call runs. In the smoke runs, Codex `exec` did this
about every 30 seconds. After an error or a cancel, the agent does not point to a takeover window.
When the agent reaches a service in the browser and the plugin for it is not in its tools, the answer
ends with a fixed sentence: install the plugin in Marketplace, on the Apps tab, or enable it in MCP
servers. The sentence names both actions because `read_agent` and the agent's tools show only enabled
servers, so an agent cannot tell a disabled plugin from a missing one.

When its own tools fail, the agent checks its teammates. When a teammate reports that it is blocked
or waits for the user, the requester does not repeat that work or send the same request again; it
gives the user the blocker and the unblock action. A blocked task reply adds a fourth line,
`Unblock:`, after Status, Result and Evidence. The delivery text of that reply
(`src/backend/agent/delivery-content.ts`) repeats the report rules, because the requester reads it
at the moment it answers. An earlier failure does not stop the agent from asking that teammate for
a new request. It never sends a task back to the teammate that gave it. The answer that gives a
delegated result starts with the teammate's name, and the agent does not say that a service was
checked unless a tool result or a reply shows it. When nothing works, the agent says what was tried
and the one action that unblocks it; for a service with a plugin, that action is to install or
enable the plugin. It can offer to create a specialist teammate, but it creates one only after the user agrees.

An agent that delegates work can follow and stop it. `openbot.list_agents` reports each agent's
`status` (a starting delivery and a context compaction count as `working`), `queuedMessages`
(channel work excluded), `turnStartedAt`, and `lastActivityAt`. The last two come from the provider
notifications that `TurnLifecycle` sees; they are in memory only, so after a restart
`lastActivityAt` falls back to the newest message for the agent. OpenBot does not record which
files a turn changed. `openbot.interrupt_agent` (`src/backend/agent/agent-interrupt-tool.ts`)
refuses the caller itself, a channel turn, and a turn that any delivery other than the caller's
started, so an agent cannot stop work from the user, a routine, or another agent. It cancels the
caller's queued requests to the target before it sends `turn/interrupt`, because the interrupted
turn drains the queue as it completes. It keeps the caller's answers, because the target can hold
them (see below). Then it queues a notice from the caller with `expectsReply` false. The notice
starts one short turn on an idle target, so the provider thread records why the work stopped.

An answer to a request that went to two or more teammates waits in the requester's queue while
another teammate's copy of that request is queued, starting or running (`MailboxStore.nextQueued`).
When the last copy ends, the waiting answers start in one turn, and the prompt names each teammate
whose copy ended with no answer. A message from the person does not wait: it starts at once and
takes the answers that are already in. Each end of a copy schedules a drain for the requester.

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
| Make a teammate whose description owns Notion, then ask a general agent about a Notion page. | The general agent delegates to the Notion teammate. Its answer starts with the teammate's name. |
| Ask the same question with no Notion plugin installed. | The Notion teammate opens Notion in the browser and requests a takeover for sign-in. When sign-in fails, the answer says what was tried and to install the Notion plugin. |

## Effect service execution

Service workflows use the catalog-pinned `effect` 4.0.0 package. Read the source and
reference material in the installed package when changing these workflows. The Electron
main process, account Worker, site-router Worker, Signal service, and shared team client
use the same version. Framework routing, IPC validation, UI rendering, and event delivery
keep their native interfaces.

Effects compose domain operations and typed failures. Promise interfaces remain at
framework and SDK boundaries. These interfaces unwrap expected failures with
`Effect.result`; defects and interruption can still reject. Existing public error
mapping and secret redaction remain the responsibility of each boundary.

Long-lived service graphs own their managed runtime and dispose it at shutdown. Provider
discovery registers disposal in the desktop teardown registry. Each remote peer owns its
runtime until peer disposal. Signal owns a process runtime. Worker service dependencies
belong to a request or invocation; they must not retain request bindings in a global
runtime. Response streams and `waitUntil` tasks retain their framework lifetimes.

Constructor-injected services expose one Effect operation per async method. Service ports
accept Effects, and callers compose them directly. There are no paired Promise facades.
Deferred values share pending results; semaphores preserve operation order; owned scopes
retain background fibers until cleanup. Synchronous SQLite transactions stay synchronous.
A mutation that must finish before rollback or shutdown uses an explicit interruption boundary.

The renderer and mobile application workflows remain outside this migration. Their native
callbacks execute shared client Effects and keep existing UI and event behavior. Electron window management,
HTTP routing, IPC handlers, SDK callback registration, and startup/teardown hooks remain
framework code. They call Effect service boundaries and await resource disposal.

The isolated agent database host imports Effect from the installed package. It keeps
its separate process, SQL authorizer, and frozen line protocol. The supervisor can still
terminate a process blocked in synchronous SQLite work. Desktop packages unpack Effect
with the host, and package verification checks that the dependency exists there.

Resources belong to the operation that acquires them. Use finalizers for file handles,
streams, temporary files, permits, and pending callbacks. Forward cancellation only to
adapters that support it. Cancellation does not make a database write or a remote mutation
safe to replay. Keep domain retry and recovery rules at their existing owners.

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
   in a leaf context or a bridge component mounted under all of them. Views, contexts and stores
   do not read `window.openbot`. They call a `<domain>-port.ts` module, which lists the bridge calls
   its domain makes, or a narrow API object that a caller can replace (`conversation-runtime.ts`,
   `provider-key-api.ts`). Cycles are rejected by `noImportCycles`, so an upward edge must be
   `import type`.
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
    structured param. Patterns cannot find a secret with no label, such as a token in an error
    text, so a store that loads a secret passes the value to `registerSecretValue`, and every later
    line masks that exact value. The provider credential store and the MCP store (for header and
    environment names that look secret) do this. `info` and above is written by default; `OPENBOT_LOG_LEVEL` lowers the
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

Current remote connections use Team API protocol v5 over three ordered WebRTC DataChannels: `rpc`,
`events`, and `files`. A sandboxed hidden Chromium page owns each `RTCPeerConnection`. Electron main
uses a `MessagePort` and transfers binary data as `ArrayBuffer`. Signal carries SDP and ICE only,
except the Slack requests of an agent's Slack app (see [Messaging connections](#messaging-connections)).
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

Capabilities describe additive behavior. The client sends its capability list when it sets the event scope. The host sends optional events only when the client declared the related capability. A missing capability disables only that feature. An unknown optional event is ignored. A malformed known event closes the connection as `protocol_error` because the client cannot safely apply it.

Team API failures use a JSON error envelope with `error` and a stable `code`. Compatibility codes are `client_update_required`, `host_update_required`, and `protocol_error`. Authentication and network failures are projected to `authentication_required` and `network_unavailable` in the desktop connection state. A confirmed compatibility or protocol error stops data-plane requests and automatic reconnect until the user selects `Retry`, restarts, or updates.

Protocol support has no fixed time or release limit. Removal is an exceptional architecture decision. It requires a security issue, data-loss risk, semantics that cannot be kept, or technical cost that cannot be contained in an adapter. The decision must also include a changelog entry, update instructions, tests for old-client/new-host and new-client/old-host directions, and clear blocking UI.

## Required verification

Run the narrowest relevant test and lint the changed files. The pre-commit hook runs `check:ui` and
the typecheck of each project that a staged file affects, and CI runs the remaining checks. See [AGENTS.md, Checks](../AGENTS.md#checks)
for the local rules, and [check design notes](development-checks.md#check-coverage) for what each CI
job covers.

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

## Prompt-driven agent profiles

Users create and edit agent profiles by asking an agent in the normal desktop or mobile
conversation. `openbot.create_agent` creates a persistent teammate with instructions and a first
task; `openbot.update_profile` changes an existing agent's name, title, instructions, generated
or custom avatar, provider, model, reasoning effort, access, Computer Use, or notifications. `avatarPath` accepts a local PNG, JPEG, or WebP file up to 512 KB, with relative
paths resolved from the calling agent’s workspace. The agent uses its available tools to resize or
compress a copy when needed. OpenBot validates the prepared file before profile changes and copies
it into managed avatar storage. Generated avatar settings remove the custom image. Both run through
the existing agent service and validate arguments before changing state.
`openbot.create_agent` also accepts an optional `provider`, `model` and `reasoningEffort`. The
read-only `openbot.list_models` returns the models of each provider that the model picker shows, with
their reasoning efforts and the default model for a request that names only a provider. An unknown
model or an unsupported effort is an error that names the valid values; OpenBot checks them before
it creates the agent. Without a provider and a model, the new agent starts on the calling agent's
provider, model and reasoning effort, so a team that one agent creates runs where that agent runs.
When the caller's provider no longer lists its model, the new agent starts on the user's default.
Creation stays this small. The calling agent then configures the new agent, or any other local
agent, with the same tools that act on itself. `openbot.read_agent` returns one agent's setup:
profile, runtime, access, Computer Use, notifications, auto-approve, installed skills, routines,
and the names and transports of the MCP servers it gets. It does not return MCP commands,
environment values, URLs, or headers, because they can hold secrets. `install_local_skill`,
`set_skill_enabled`, `uninstall_skill`, and the routine tools take an optional `agentId`; without
it they act on the caller. `uninstall_skill` never removes skill files that the user changed.
An agent can only restrict access and Computer Use, for itself or a teammate. The router writes
only a restriction, so a user change between its check and the write is never undone. Only the
user widens them again, and only the user changes auto-approve, MCP servers and local script runs. A new agent gets
the access and Computer Use limits of the agent that creates it, so a Workspace-only agent cannot
get around its sandbox through a teammate. There is no creation step for skills or routines in
the UI.
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

The same handoff carries a chat to another provider after a provider switch. It holds the user and
assistant messages after the last context-reset marker, with attachment names only. OpenBot stores
no tool steps, so the work log comes from the providers. At the switch, before the old sessions are
retired, `ThreadLifecycle.readWorkSteps` reads each active session with `thread/read` through the
client that holds it, with a 10-second limit. The switch then checks again that no turn started.
Only after the switch is stored, `saveWorkSteps` writes the rendered steps of the 60 newest turns to
`provider-work-steps/<sha256(session id)>` (mode 0600), or `{}` for a session with none. The sessions
are retired before the write, so a turn that starts during it keeps its new session and reads the
provider instead. The file is
deleted and reconciled with the other session files, and a file that does not parse counts as no
capture. A session without a capture, such as one that no client held, is read when the
handoff is built: only the three newest, on their own providers, with a stopped CLI started again
and one 10-second limit for the start and the read. From the turns that match a transcript message,
`renderTurnSteps` adds a work log: commands with exit code and output tail, changed file paths, tool
calls, searches and progress notes. Each field is redacted before it is cut, and each turn has a
size limit. Reasoning, diffs, images and other provider-private state stay with the provider that
made them. A failed capture or read leaves that session's steps out. Codex returns tool steps from
its stored rollout. Claude returns only notes. An ACP agent keeps only the text and thinking of its
turns, so it also gives only notes, and only while its process holds the session: the handoff read
sends no `cwd`, as the boot backfill does, so a session that the process released is not opened
again. That handoff read uses the shared provider process, so a session that ran in a Workspace only
process gives no steps unless the switch captured it.

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
not prove a visitor typed the address.

An article reports its own path, so one article can be told from another. `safeScreenPath` and the
`slug` property check resolve the path against the `src/lib/news.ts` and `src/lib/guides.ts`
registries, so the reportable set stays closed: an unknown slug reports `/` and is dropped from the
payload. `articleFromPath` gives the delegated click listener the same lookup, which is what lets it
track article cards at all; their hrefs carry a slug and cannot be matched by the exact-href
allowlist the other links use. The hero selector reports its detected platform through
`trackDownloadSelected` before the page component calls `start`, so a short bounded queue holds
events until the client exists rather than dropping the first one.

`landingCampaignPath` rebuilds the reported screen path with only the five allowlisted `utm_*` tags,
lowercased and bounded to 64 safe characters; every other parameter and the hash are dropped by
construction. The path travels on every event of the page load, not only `screen_view`, because
OpenPanel reads campaign attribution from whichever event creates the session, and the two events
are sent concurrently.
See [PRIVACY.md](../PRIVACY.md) for the data boundary.

The OpenPanel Growth dashboard uses a session funnel from `landing_viewed` to
`landing_download_clicked`. A download click is not a completed download or installation.
Break down the funnel by `acquisition_source`, then `source_platform` once schema version 8
events reach OpenPanel. Historical events do not contain the new platform property.

The `/download/<os>/latest` Worker handler falls back to the releases page when the GitHub manifest cannot be
read. That fallback is written to the Worker log, not to OpenPanel: a server event has no session,
and the landing dashboards are defined on sessions.

For download-click reports, `platform` means the requested macOS, Windows, or Linux download;
`placement` means the button location. These properties exist only on the download step.
Use them to compare click counts, not as a shared visit-to-click funnel breakdown.
The invitation-page funnel is separate: `join_page_action` with `action=view` followed by
`action=download` or `action=open_app`.

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
The iPhone app opens Usage from the server menu in a sheet. It reads the same route through
`readHostAnalytics` in `@openbot/team-client` and shows the per-agent rows; a row or the header
filter narrows the report to one agent. The agent Usage page reads the same route with the agent
filter, so its chart has the provider split too; a host without `host-analytics` gets the
agent-scoped route and one area. The series pivot is in `@openbot/team-client/usage-series`, which
the desktop chart also reads.

`host:get-analytics` and the optional `host-analytics` capability expose `GET /v1/analytics`.
The host queries its local usage tables once for the date range and optional agent filter; it does
not add per-agent API responses. The one pass groups by agent id beside day and model, so the
host-wide response carries per-agent rows that the client labels from the agent list it already
reads. The same pass also groups by day and provider, which is what lets the chart draw one area
per provider over a shared baseline; a cell carries only the token count and the cost estimate,
because those are the two measures the chart reads. Both arrays are on the host report only, which
is why the agent-scoped route and its codec are unchanged. Session and turn identities include agent and provider. HTTP and
WebRTC use an explicit host analytics codec. Existing agent analytics and account limits keep their
contracts. All authenticated team members can read these aggregates; no additional analytics data
is stored by the account service or Signal service.

The desktop chart adapts Zaidan's chart and interactive area composition. The pinned
`solid-recharts` dependency has a Solid 2 compatibility patch and uses the application's single
Solid runtime. Chart colors use OpenBot tokens. Daily tables provide exact accessible values.

## Agent import

Server Settings > Import moves agents from a `.zip` export into the local host, or into a remote host
that serves `agent-import-v1` (see [Agent import from a joined server](#agent-import-from-a-joined-server)).
The format is `openbot-import.json` plus `agents/<key>/`
folders. `resources/agent-import/grok-bot/SKILL.md` writes it and `src/main/agent-import-manifest.ts`
reads it; both are a product contract, so add only optional fields and raise `version` for a change
of meaning. The renderer never names a path: `agent-import:choose` opens the dialog in main, and
`AgentImportService` keeps the checked export and its SHA-256 under a single-use token; `apply`
refuses a file that changed. `stage` measures entries without inflating them and rejects paths that
`isUnsafeArchivePath` in `skill-package.ts` refuses or that name a Windows drive. `apply` checks all
skills of an agent, creates it through `AgentService` and publishes skills through the local skill
library; an agent whose step fails is deleted with the skill revisions it published, and the others
continue. An optional `channels` list carries Grok Bot group chats. After the agents, each selected
channel is created through `ChannelService.command` as the local user (`host.channelActor()`), with
the members and lead mapped to the new agent ids; a channel needs one imported member, and one whose
memory step fails is deleted. Step 1 offers two ways to add the export agent: its Grok Bot link, or the skill set up by hand.
`agent-import:read-skill` and `agent-import:save-skill` give that skill from the app's resources
(`extraResources` in `electron-builder.yml`); main opens the save dialog, so the renderer names no path. No schema change is needed.

## Storage and files

Three surfaces show what a host keeps on disk: Server Settings > Storage (scope `host`), Agent
settings > Files (scope `agent`) and the chat Files panel (scope `conversation`). They share
`src/renderer/src/features/files/storage-usage.ts`, which names the server explicitly, because Server
Settings can be open for a server that is not the selected one.

`src/backend/storage-usage.ts` owns the scan and has no Electron imports. Sent and generated files
come from the mailbox state in memory, with their chat from paged read-only queries in
`database/storage-usage-queries.ts`; a file's status comes from `stat`, not from
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
`logs/update` and `logs/providers` files; it does not enter `logs/remote/transfers`. Runtimes are read-only.

`storage:*` IPC reaches the local service or a joined server. The optional `storage-v1` capability
exposes `POST /v1/storage/usage`, `/v1/storage/delete-file` and `/v1/storage/clear` with the frozen
codec in `team-protocol/storage-v1.ts`. The host advertises it only when its storage service
exists. Every member reads usage; delete and clear need an owner or admin (`requireAdmin`), and the
renderer hides those controls from a member. The wire carries no absolute paths, and workspace and
download files travel only as category totals. A host without the capability reads as null, and the
surface asks for an update; a change is refused before any request.

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

### Skill events

`skills-events-v1` adds one optional event, `skills-changed { agentId }`. The host sends it after
each change to the installed skills of an agent: install, update, uninstall, turning a skill on or
off, and a skill an agent creates. `SkillMarketplaceService` calls its refresh callback after every
write, and that callback emits the event through `AgentService`, so this computer's windows get it
too. The event carries no skill data: a client reads the list again through `installed-skills` or
`skills-admin-v1`. `team-protocol/optional-events.ts` is the one place where each transport
recognizes the optional events that the frozen base vocabularies reject.

### Admin capabilities

An owner or admin of a joined server manages its host through optional `POST /v1/admin/...` routes.
Each capability has a frozen codec in `team-protocol/<name>-v1.ts`, registered in
`team-protocol/optional-routes.ts`, and both transports use it. Every route calls `requireAdmin`. The
host advertises a capability only when its `TeamApiAdmin` member exists.

| Capability | Grants | IPC group |
| --- | --- | --- |
| `agent-admin-v1` | Agent access and auto-approve | `agentAdmin` |
| `skills-admin-v1` | List, install, remove, enable skills by marketplace id | `agentAdmin` |
| `shared-tables-v1` | List and delete shared tables | `agentAdmin` |
| `agent-install-v1` | Add an agent from a listing or a shared template, by id | `agentAdmin` |
| `agent-update-v1` | Update an agent added from a listing to the listing's current version, by id | `agentAdmin` |
| `providers-v1` | Code sign-in, provider API keys, managed runtimes, custom endpoints | `providerAdmin` |
| `providers-v3` | Code sign-in for Codex, Claude and Grok; send the code a Claude sign-in page shows | `providerAdmin` |
| `providers-v4` | Code or link sign-in and managed runtimes, Cursor and Cline included | `providerAdmin` |
| `host-admin-v1` | Server name and logo | `hostAdmin` |
| `host-update-v1` | Check for, download and restart into an app update; cancel a restart that waits | `hostAdmin` |

These IPC groups take a required server id and route with `scopedHandler`. A key travels only towards
the host; no response carries one. `providers-v1` has no progress event, so the renderer reads runtime
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
`codeSignInProviders` in `server-capabilities.ts` picks the providers that the Providers list offers
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

`host-update-v1` runs the same update as the host's own Settings. `src/main/requested-update.ts`
keeps the schedule in memory: who asked, and whether the restart waits until
`describeRestartReadiness` reports no running work or happens as soon as the update is ready. The
host user can turn the routes off with "Allow updates from server admins" (`openbot-update-preference-v1.json`,
default on) and can cancel a restart that waits. The host still advertises the capability when the
setting is off, so the client can show why. A Host Manager tenant refuses the routes. The client
reads the status again every second while a check, a download or a restart runs. An admin can also
set the host's automatic download and automatic install when idle through the settings route; an
automatic install is a schedule with no requester.

When an admin connects, `host-update-toast.tsx` reads the status once: it offers a new version and
shows a live percentage while the host downloads. All members get the `host-restart` event
(`waiting`, `restarting`, `none`) from the host's event stream, and the host sends the current state
again when a client declares the capability. Like `channelEvent`, the event skips the frozen v1-v3
event encoders at each hop (host peer, client transport, `remote-peer.ts`, SSE stream). A client that
loses the host while a restart waits treats it as the restart: desktop keeps the fast WebRTC retry
instead of the `host_unavailable` wait for 10 minutes, and web tries again every 5 s for 3 minutes.
`host-restart-toast.ts` shows the notice until the host is back, for 10 minutes at most.

## OpenCode and ACP

`src/backend/acp-client.ts` owns ACP process transport, model discovery, session start/load,
streamed messages, permissions, tool bridging, and cancellation. `grok-client.ts` supplies xAI
login and billing hooks. The OpenCode driver starts `opencode acp` on the runtime OpenBot pins and
downloads, or on a CLI the user installed. Profile clients deny tool permissions.

OpenCode has no login step OpenBot can drive, because the account is one environment variable: a
spawn without `OPENCODE_API_KEY` lists the free OpenCode Go models, and a spawn with one lists the
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
catalog, on the separate endpoints `opencode.ai/zen/v1` and `opencode.ai/zen/go/v1`, and OpenBot
supports only Go. So `isOpencodeModelUnusableWithStoredKey` in `src/backend/agent/provider-runtime.ts`
drops the paid Zen models from `#refreshModelCatalog` while OpenBot is the one supplying the key;
with no key stored those models can only come from the user's own OpenCode sign-in, which does
buy them. Neither `/models` endpoint authenticates, so entitlement cannot be read back and the
split is a product rule rather than a check.

`PREFERRED_MODEL_ORDER` in the same pass reorders that catalog, because a provider with no
`defaultProviderModel` runs the first model of its list and OpenCode reports the third-party
services the user signed in to before its own — so the fallback used to pick a model behind a token
OpenBot can neither see nor refresh. `opencodeModelRank` sorts free models first with Muse ahead of
the rest, then OpenCode's own paid models, then everything behind a separate sign-in. The sort is
stable, so the CLI's order survives inside one tier.

Free means a display name ending in "Free": `model/list` carries no price and neither Go endpoint
authenticates, so the name is the only signal. `isFreeOpencodeModelName` in
`packages/contracts/src/agent-providers.ts` is shared with the picker badge in
`src/renderer/src/components/provider-model-options.ts`, so a badge and a default cannot disagree
about what costs money.
Provider session IDs remain in `projection_provider_sessions`; migration 17 adds OpenCode while
preserving turn links. Provider switches keep the same agent, workspace, and local thread.

### Gemini

The Gemini provider (id `antigravity`) starts Google's Antigravity ACP server
(`agy_acp_server`). Google's license does not allow redistribution, so the runtime manager
downloads the zip on the user's computer. `extractZipFiles` in `src/main/provider-runtime-archive.ts`
accepts only the server and `localharness_external`, which the server starts from its own folder.
The server has no `--version`, so staging writes `antigravity-package.json` and
`verifyInstalledRuntime` reads the version from that file (`versionFile`). OpenBot never searches
`PATH`, because the Antigravity editor installs an `antigravity` command that is not this server.

Sign in is an ACP `authenticate` call with `oauth-personal`, in a separate process
(`src/backend/acp-sign-in.ts`): the server opens the browser and waits, and a status probe must
never wait for that. The serving client never calls `authenticate`. A signed-out server answers
`session/new` with "Authentication required", which the client reports as sign-in required.
The server runs confined; `antigravityStatePaths` gives it `~/.gemini/antigravity-acp` and
`~/.gemini/artifacts` and protects its settings files. Migration 22 adds `antigravity` to
`projection_provider_sessions`.

Team API v1–v4 do not know `antigravity`. The host hides Gemini agents, models, status, and
sign-in state from peers on those versions, and the `providers-v1` routes omit it. Team API v5
carries Gemini, and the `providers-v2` runtime routes let an owner or admin download or cancel the
host's Gemini runtime. Gemini signs in through a browser on the host, so no peer route signs it in.

### Cursor

The Cursor provider (id `cursor`) starts the Cursor CLI with `cursor-agent acp`. Cursor's terms do
not allow redistribution, so the runtime manager downloads the archive on the user's computer.
`extractZipTree` in `src/main/provider-runtime-archive.ts` extracts the Windows zip and accepts only
entries in its `dist-package` folder; staging renames that folder to `bin`. The CLI's `--version`
is not usable on Windows, where the launcher is a `.cmd` file, so staging writes
`cursor-package.json` and `verifyInstalledRuntime` reads the version from it. A lock install also
checks the SHA-256 of each file in `files`. `resolveCursorCli` looks for `cursor-agent` on `PATH`,
never `cursor`, which starts the Cursor editor.

Sign in is an ACP `authenticate` call with `cursor_login`, in a separate process, as for Gemini.
`CURSOR_API_KEY` in the environment also signs the CLI in. A confined Cursor process gets
`CURSOR_CONFIG_DIR=~/.cursor/openbot-confined` (`cursorConfinedEnv`): the CLI writes
`cli-config.json` when a session starts and fails when it cannot, and that file also holds the
user's permissions. `cursorStatePaths` lets it write `~/.cursor` and protects the user's settings,
hooks, rules, MCP and permission files there and in the CLI config folder, and the
`.workspace-trusted` and `mcp-approvals.json` files in each folder in `projects`. Migration 24 adds
`cursor` to `projection_provider_sessions`.

Team API v1–v5 do not know `cursor`. The host hides Cursor agents, models, status, and sign-in
state from peers on those versions, and the `providers-v1` to `providers-v3` routes omit it. A route
that reads an agent ID from the body answers 404 for a hidden agent (`requireVisibleBodyAgent`). A
peer cannot create an agent, or add one from a template, the marketplace or an import, when the host
would start it on a hidden provider (`newAgentProvider`). A custom endpoint saved with the id
`cursor` before the provider existed stays visible. Team API v6 carries Cursor, and `providers-v4`
lets an owner or admin download the host's Cursor runtime and sign it in from another device.

### Cline

The Cline provider (id `cline`) starts the Cline CLI with `cline --acp`. The runtime manager
downloads the npm platform package `@cline/cli-<os>-<arch>` and stages all of it except
`package.json`: the CLI finds `extensions/plugin-sandbox-bootstrap.js` next to its `bin` folder. The
npm packages have no license file, so staging downloads `LICENSE` from the `cli-v<version>` tag and
checks the pinned hash. `resolveClineCli` refuses a CLI older than 3.0.68.

By default the CLI runs its sessions in a hub process that it detaches and that other Cline
processes share. That process outlives OpenBot and is outside a Workspace only sandbox, so every
Cline process, the sign-in included, gets `CLINE_SESSION_BACKEND_MODE=local` and
`CLINE_NO_AUTO_UPDATE=1` (`CLINE_ENV` in `provider-drivers.ts`). Sign in is an ACP `authenticate`
call with `cline`, as for Gemini. `CLINE_API_KEY` in the environment also signs the CLI in.
`clineStatePaths` lets a confined process write `~/.cline/data` and protects the global settings,
the MCP and connector settings, and the cron, task and connector databases there. The agents,
skills, hooks and plugins in `~/.cline` and `~/Documents/Cline` stay read-only. Cline answers a lost
session with the ACP error `-32002`, which `AcpAgentClient` reads as a missing session. Migration 26
adds `cline` to `projection_provider_sessions`.

Team API v1–v5 do not know `cline`. The host hides Cline agents, models, status, and sign-in state
from peers on those versions, as for Cursor. Team API v6 and `providers-v4` carry it, as for Cursor.

Team API v4 has its own frozen provider-aware schema and adapters. Versions 1–3 remain registered
with their released provider vocabulary. The host filters OpenCode agents, models, status,
sidebar references, and runtime events before encoding an older client's response. Requests for
an OpenCode agent from those clients return 404. WebRTC keeps its v2 frame transport and selects
the v4 application codec when the peer advertises the `opencode` capability.

Team API v5 is the v4 schema with `antigravity` and `acp` added to the providers and auth kinds
(`v5-base.ts`). WebRTC selects it when the peer advertises `local-providers`, and HTTPS negotiates
it from the protocol range. A v4 peer still gets the filtered view. A peer counts the host's
custom agents from the `acp` models; the host never sends an agent's command, arguments or
environment.

Team API v6 is the v5 schema with `cursor` and `cline` added to the providers and auth kinds, and
`=` and `,` added to the agent model charset for Cursor model ids (`v6-base.ts`). WebRTC and the
event stream select it when the peer advertises `local-providers-v2`, and HTTPS negotiates it from
the protocol range. `GET /v1/agents/models` sends a v1–v5 peer only the ids its charset accepts. A
v5 peer still gets the filtered view.

### Custom agents

The provider `acp` runs ACP programs that the user saves. The model id names the agent:
`<agentId>/<model>`, or `<agentId>/default` for an agent that lists no models. So `agent_json` does
not change, and the agent id pattern (`CUSTOM_AGENT_ID_PATTERN`) has no `_`, which `isAgentModel`
refuses. `src/backend/custom-acp-agents-client.ts` is one `AgentClient` over one `AcpAgentClient`
for each agent and working folder, which it starts when a thread first needs it: an agent can serve
one folder for each process (Command Code refuses a session in a second folder). `model/list` uses
one more process for each agent, in a private temporary folder, so the probe session never opens on
a process that serves a thread. A session id gets the prefix `<agentId>:<folderTag>:` (12 hex
characters of the SHA-256 of the folder), so two agents, or two folders of one agent, that give the
same session id stay apart; a session saved before this keeps its `<agentId>:<sessionId>` id, and
the folder of its resume finds its process. Requests that an agent sends get an id of the router's
own. A thread on another agent than its model reads as a missing session, and the
runtime hands the conversation over as for a provider switch. When a process that serves a thread
exits, the router exits, and every custom agent restarts. When a model list process exits, the
next list starts another.

`src/main/custom-agent-store.ts` keeps `custom-agents.json`: env names in plain text and all env
values in one `safeStorage` ciphertext. `list()` returns summaries; only the backend gets the
values. `customAgents.check` starts the program in a temporary folder, sends `initialize` only, and
stops its process group. The scan (`src/backend/acp-agent-scan.ts`) looks up the preset names on the
login-shell `PATH` and in the user's folders, and never starts a file. The agents run confined with
no state paths. Migration 23 adds `acp` to `projection_provider_sessions`. The host hides `acp`
agents, models, status, and sign-in state from peers before protocol 5, and the `customAgents` IPC
group is local only.

### Local detection and endpoint edit

The `providerDetection` IPC group scans local model servers and custom agents, loads the models of
an address, and reads and writes the Local detection settings
(`src/main/provider-detection-settings-store.ts`). `customProviders.update` edits a saved endpoint:
a key or headers that the renderer does not send stay as stored, and a new origin with a kept key is
refused. Both are local only: `providerAdmin` and the Team API take `PeerCustomProviderChanges`
(`list`, `save` and `remove`), so a peer cannot reach them. The renderer
store (`features/custom-providers/stores/provider-detection-store.ts`) marks the found rows that are
saved, and a joined host gets no detection and no Edit.

## Desktop server notifications

Each desktop profile stores muted server IDs in `servers.json`. `RemoteServerStore` saves a
mute change before publishing it. These preferences survive restart, re-login, and host-list
reconciliation. The server context menu controls mute for local and remote servers.

`renderer-forwarders.ts` continues to deliver live events for muted servers, but suppresses
system notifications. Remote notification content uses the source server's agent list. Both
server mute and per-agent notification settings apply. Unread state is unchanged. Mobile does
not deliver system notifications; it shows agent state in its Live Activity. Mute settings are not
synchronized between devices.

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

The agents of a computer can answer in an external chat platform. Slack is the first platform;
[messaging.md](messaging.md) has the setup, the limits and how to add a platform. Every workspace
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
  development apps can share a workspace. It passes the exact body to the `ingress` socket (`SlackIngress` in main, a plain `ws` client: no WebRTC, so no hidden
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
  use, so a hosted server does not idle out.

## Skill folders and MCP configuration

A skill follows the [Agent Skills specification](https://agentskills.io/specification): a folder
`<name>/` with a `SKILL.md` file. The YAML frontmatter has `name`, which is the folder name, and a
`description` of 1 to 1024 characters. Each provider CLI finds skills in its own folders:

| Folder | Written by | Read by |
| --- | --- | --- |
| `<workspace>/.agents/skills/` | OpenBot, the user, the agent | Codex, Grok, OpenCode, Gemini, Cursor, Cline |
| `<workspace>/.claude/skills/` | OpenBot, the user, the agent | Claude Code, OpenCode, Cursor |
| `<workspace>/.opencode/skills/` | the user, the agent | OpenCode |
| `<workspace>/.gemini/skills/` | the user, the agent | Gemini |
| `<workspace>/.cursor/skills/` | the user, the agent | Cursor |
| `<workspace>/.cline/skills/`, `<workspace>/.clinerules/skills/` | the user, the agent | Cline |
| `~/.agents/skills/` | the user | Codex, Grok, OpenCode |
| `~/.claude/skills/` | the user | Claude Code, OpenCode |
| `~/.codex/skills/`, `~/.config/opencode/skills/` | the user | Codex, OpenCode |

A confined agent (Grok, OpenCode, Gemini, Cursor or Cline, not in Full access) cannot write the workspace
skill folders: `src/backend/process-confinement.ts` protects them as project settings.

OpenBot writes each skill that it installs to both `.agents/skills/<slug>` and
`.claude/skills/<slug>`, because Claude Code does not read `.agents/skills`. It copies the files and
does not make links. `.openbot/skills-lock.json` in the workspace records the file hashes, and
`.openbot/skills-disabled/` holds disabled skills. A bundled skill has an `.openbot-managed.json`
marker.

`src/main/skill-folder-discovery.ts` lists all other skills in the seven workspace folders as
`workspace` skills. The list is read-only: OpenBot never writes, moves or deletes these folders, and
they do not count toward the agent's skill limit. A folder without `SKILL.md` is not a skill. A
skill gets a `problem` when its `SKILL.md` does not follow the specification, or when it is in a
folder that the agent's provider does not read. An agent keeps its workspace when its provider
changes, so a skill in `.agents/skills` stops working after a change to Claude Code. A skill with a
problem is not offered as a chat tag.

OpenBot does not list the home-directory folders. They hold the host user's skills, which are the
same for every agent, and each provider CLI changes its home-folder rules without notice.

MCP servers do not use folders. `projection_mcp_servers` in SQLite is the source of truth for the
whole computer. No shared MCP file format exists: Claude Code reads `.mcp.json` and
`~/.claude.json`, Codex reads `config.toml`, OpenCode reads `opencode.json`, and Cursor, Cline and
Gemini CLI read their own folders. OpenBot writes none of these files. It gives the servers to each
provider when the session starts. Claude starts with `strictMcpConfig`, so it ignores `.mcp.json`
and its user settings (see `plans/003-mcp-works-on-a-clean-machine.md`). The panel masks header and
environment values, `src/backend/mcp-redaction.ts` removes them from logs, and OAuth tokens are in
`safeStorage`.

The 1Password connector is built in and has no SQLite row. `src/main/onepassword-connector-service.ts`
runs the user's `op` CLI once to create the vault "Shared with OpenBot" and a `read_items` service
account, or takes a pasted service account token. Before Connect, the page shows three setup steps
that `checkSetup()` reads: a CLI of 2.18 or later (the user's own on `PATH`, else the copy that
`src/main/onepassword-cli-installer.ts` downloads, with a SHA-256 pinned per target, into
`<userData>/provider-state/1password-cli`), the 1Password app's CLI integration (`op account list`
answers at least one account), and Connect. The service keeps only the token in
`openbot-onepassword-connector-v1.json`, encrypted with `safeStorage`. It reads the vault with
`@1password/sdk` and implements `PasswordVault` (`src/backend/password-vault.ts`). The developer
instructions tell agents about the vault only while `PasswordVault.connected()` is true, read at
each session start and resume, because most users have no vault. The agent service
uses it in two places: `openbot_browser.list_logins` returns the logins saved for the tab's HTTPS
site (id, title, username), and `AttentionRegistry` answers a `submit_secret` password or
authenticator request for a saved login by filling it through the same `prepareSecret` path as the
secure card, with no card. On an origin where an agent ran `evaluate` during this app session,
`BrowserHost` reports `agentScriptedOrigin` and the card opens instead, because the agent's script
could read the filled fields. A login matches by 1Password's autofill rule, on the registrable domain
with private suffixes such as `github.io` counted. Agents and providers never receive the token, a
password or a code.

The GitHub connector is built in and has no SQLite row. `src/main/github-connector-service.ts` signs
in to the `openbotgit` GitHub App with the device flow, which needs only the public Client ID, and keeps
the tokens in `openbot-github-connector-v1.json`, encrypted with `safeStorage`. While it is
connected, `McpGateway.enabled()` adds the `openbot-github` server (`api.githubcopilot.com/mcp/`),
and `authorization()` gives it a fresh bearer at each hand-off. An enabled server that the user added
with the name `github` wins. For `gh` and `git`, the service writes the token to
`<userData>/provider-state/github` (mode 0600), and each provider gets `GH_CONFIG_DIR` and a
`GIT_CONFIG_*` credential helper that reads that file. The environment holds only paths, never the
token. Codex gets these values through `shell_environment_policy.set` in the thread config.

A user token makes GitHub show "user with OpenBotGit". To show `openbotgit[bot]`, the desktop sends
the user token to `POST /v1/github/installation-tokens` on the account Worker
(`apps/auth-api/src/server/github-installation-tokens.ts`). The Worker holds the app's private key
(`GITHUB_APP_PRIVATE_KEY`, PKCS #8) and signs an app JWT. It mints one installation token for each
installation of this app, limited to the repositories where the user can push, maintain or
administer, and stores nothing. With no key it answers 503, and the desktop keeps the user token.
`src/main/github-bot-tokens.ts` renews the set ten minutes before the first token expires.
- `git`: the helper runs with `useHttpPath`, and takes the bot token for the repository from
  `provider-state/github/repositories`, or else the user token.
- MCP: `src/main/github-mcp-proxy.ts` is a loopback MCP server with a secret bearer. It forwards to
  `api.githubcopilot.com/mcp/` with one upstream client for each token, because GitHub binds an MCP
  session to its token. A tool call with `owner` and `repo` arguments uses that repository's bot
  token. The port and the secret stay in the encrypted record, so a resumed Codex session keeps its
  URL and header.
- `gh` has one token for each host, so it acts as the user.

A pull request that an agent opens with a bot token has `openbotgit[bot]` as its author, so the user
who asked for it can approve it. A branch rule that needs one approval then passes with no second
person.

## Local skill library

`src/main/local-skill-library.ts` owns immutable revisions under the application's user-data directory, in `local-skills/<local-skill-uuid>/<revision>/bundle.zip`. A staging directory is renamed only after the bundle is written; reads ignore unpublished staging directories. Revisions are serialized and checked against the caller's expected revision. No SQLite migration is required.

The shared package validator handles local and marketplace bundles. The existing installer owns per-agent files, hashes, disabled storage, and both provider directories. Local installations skip marketplace downloads and receipt requests. Installation operations are serialized per agent; a library revision does not update installed copies.

The backend local skill tools derive the agent from the calling provider session. Main-process IPC validates local library inputs independently of sender validation. The renderer reads local previews through that bridge. The released Team API adapters are unchanged; local creation and revision are not exposed as remote operations.

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

## Plugin distribution

A plugin is one developer's bundle: an MCP server, shown as an app, the skills that drive it, and the listing text. The catalog of available plugins is a static file set that the Account Worker serves from `openbot.run` without an account, and the main process keeps a copy in the user-data directory rather than in SQLite, because a remote catalog is a cache and not the source of truth. An install saves the app as a host-global MCP server and installs the pinned skills into the chosen agent. A share link at `openbot.run/plugins/<slug>` opens a public page, and `openbot://plugins/<slug>` opens the listing in the app; neither one installs anything.

See [plugin distribution and sharing](plugin-distribution.md) for the catalog shape, the fetch and cache rules, the install and uninstall order, the deep-link parser rules, and the security review. Two parts of that design run today. The Apps tab installs the listing's pinned skills into the chosen agent and saves its app as a host-global MCP server. The links work: `openbot.run/plugins` and `openbot.run/plugins/<slug>` are pages on the public site, and `openbot://plugins/<slug>` opens that listing in the app, which is the second kind `src/main/deep-link-router.ts` recognises beside an invitation. Both sides read one catalog, generated from `marketplace/plugin-catalog/`, because a listing that said one thing on the page and another in the app would be two catalogs. The catalog files, the Worker routes that serve them, the cache in the main process, and uninstall are still design.

## Agent templates

An agent template is a link-only copy of one local agent: the name, title and instructions, the
avatar, the routines, marketplace skills as references to approved versions, and local skills as
their `SKILL.md` text. It has no workspace files and no memories. The Publish button in the chat
header opens `PublishAgentDialog`; `src/main/agent-template-service.ts` builds the snapshot, stops
when a text field looks like a secret, and posts it to the Account Worker. The Worker keeps one row
per account and local agent in D1 `agent_templates`, so a second publish updates the same link.
Unpublish clears the row's content and images and sets `unpublished_at`, but keeps the row, so the
same agent published again gets the same link. An account can have up to 5 published agents; the
Worker checks this in the statement that writes the row, so a client or two requests at once cannot
pass it, and unpublished rows do not count.
There is no review and no marketplace listing. Before a publish, the renderer draws a 1200×630 share
card (`agent-template-card.tsx`) with the agent's avatar and text. It draws it there because the
avatar and its fonts are there, and it uses a `data:` URL because the Content Security Policy
refuses `blob:` images. The Worker accepts only a PNG of that size, stores it in R2, and serves it
as the page's `og:image`, so a post on X shows the agent. `openbot.run/agents/<id>` is a public
card page, tinted with the avatar colour. The Bloub library uses browser-only APIs when its module
loads, so the page loads the avatar and its colour in the browser after hydration. Its button opens
`openbot://agents/<id>`, the third renderer link kind in
`src/main/deep-link-router.ts`. The app then shows the template in `AgentTemplateInstallDialog`;
like a plugin link, the link itself installs nothing. The page's fallback line also links
`/app?agent=<id>`, where the browser client shows the same preview. In the same way, the invitation
page links `/app` with the four invitation fields, and a plugin page links `/app?plugin=<slug>`. The
browser client removes these fields after it reads them and opens the join dialog or the marketplace
listing. It never joins or installs without a press.

## Billing

Billing is per server. One account can pay for several servers; each server has its own Stripe
subscription. The Account Worker (`apps/auth-api/src/server/billing-service.ts`) talks to the Stripe
REST API with `fetch`; there is no Stripe SDK. The plan catalog in `packages/contracts/src/billing.ts`
holds only the plan IDs, storage and lookup keys. The amounts are six Stripe Prices with the lookup
keys `openbot_{plan}_{interval}`. `bun run api:stripe:bootstrap` (`scripts/stripe-bootstrap.ts`)
creates them and the Customer Portal settings.

- The add server dialog starts a plan. The hosting service
  (`apps/auth-api/src/server/hosted-billing.ts`) makes the Stripe customer before the Checkout, so
  two open Checkouts use one customer. The Checkout sets the subscription metadata
  `openbot_user_id` and `openbot_server_id` (`BILLING_METADATA`). The billing service calls the
  `onSubscriptionSynced` hook after each subscription sync; the hosting side uses it to provision,
  stop and resume servers, so billing does not know about boat. See
  [hosted servers](hosted-servers.md#lifecycle). The webhook links a new Stripe customer to the
  account from `openbot_user_id`. It never moves a known
  customer to another account, and it skips a subscription that names no account.
- Desktop Settings → Billing and the web Billing dialog render `@openbot/ui/features/billing`: one
  row for each open plan, with the server name, the plan, its price, and a menu to change or cancel
  it. The price is the list price of the Stripe Price in the subscription's currency (from
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
See [multi-tenant hosting](multi-tenant-hosting.md) for installation, permissions, and acceptance.

## Remote desktop permission checks and live tests

`RemoteScreenGateway` owns setup checks and live-test session ownership. The optional
`remote-desktop-setup` Team API capability uses separate v4 adapter routes; released codecs remain unchanged.
Diagnostics contain host/account names and permission results and travel only to an authenticated member.
They do not include Sunshine credentials or screen content. The renderer opens macOS settings only through
fixed local IPC actions.

Sunshine checks its own macOS permissions and hosts the temporary native test panel. During a test, native
input is restricted to that panel and tagged for the test. The panel requires both the test tag and the
Sunshine process ID before recording a click or keyboard result. The gateway rejects additional sessions
and display switches during a test and closes the panel when its owning stream disconnects. It does not
interrupt another member's session to start a test.

Local tests use a temporary HTTP listener bound to `127.0.0.1`, without publishing the host or requiring an account. The same single-use viewer grant and cookie checks protect it. The gateway owns the listener and closes it with the test session; its lease expires after three minutes. Local test IPC can address only sessions created for this purpose.

A local video-only test can run without native diagnostics. Its viewer iframe is inert and excluded from keyboard focus; it does not start a native input test or report input success. Local loopback test cookies use HttpOnly, Secure and SameSite=None so the embedded viewer works across the app origin.

On Linux, the gateway accepts only an X11 session (`DISPLAY` set, no `WAYLAND_DISPLAY`, and
`XDG_SESSION_TYPE` not `wayland`). Sunshine then runs with X11 capture and software encoding, and
sends input through XTest, so a hosted server under Xvfb needs no uinput device and no extra
capability. Linux has no permission checks: an X11 session is ready.

## Secure browser authentication

`openbot_browser.submit_secret` uses the existing attention/takeover lifecycle with optional public
secret-request metadata. The attention registry creates a fresh request ID and owns the pending
response. The secret travels through a dedicated typed IPC endpoint or the optional
`browser-secret-handoff` Team API capability, never a prompt answer or provider tool argument.
Frozen protocol projections continue to show ordinary takeover to older clients. Current codecs
carry validated metadata beside those projections. There is no database schema change.

The browser host owns the protection state and serializes entry behind existing browser work. CDP
resolves fields before consent and checks the document and origin again before entry. The host
stops recording, suppresses page diagnostics, blocks inspection and capture, rejects remote input,
and invalidates existing live-view streams. Capture protection remains after same-document navigation
or an uncertain submission. After a completed submit action without document replacement, the host
waits up to five seconds, then empties the filled fields. When every field is empty and an automation-world scan finds the
value in no title, URL, text node, value, or attribute, including open shadow roots, it keeps the
document so a single-page sign-in can show its next step, and blocks evaluation and recording in the
opener group until a main-frame navigation, which also clears history. Otherwise it loads the current
URL with GET to replace the document without replaying a form POST. Failure retains protection and falls back to takeover. A new document releases it and
clears navigation history; manual takeover
completion alone cannot release it. Secrets are not retried. Authentication inside unsupported frames,
unclear OAuth account selection, CAPTCHA, passkeys, and payment confirmation use takeover.

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
[hosted servers](hosted-servers.md) for the flow, the configuration, the memory guards and the template.

A self-hosted server uses the same Linux build, scripts and units on the owner's own computer, with
`/opt/OpenBot/hosted/mode` set to `self`. It has no claim: main starts in server mode
(`src/main/server-mode.ts`, `OPENBOT_SERVER=1`), and the `openbot` terminal command signs it in over
a Unix socket in the 0700 runtime directory of the service user. Main publishes the host after each
sign-in. See [self-hosted servers](self-hosted-server.md).

## Shared UI package

`@openbot/ui` owns the existing SolidJS primitives and their primitive stylesheet. Desktop,
web, and Storybook import this workspace directly. It has no dependency on the renderer,
Electron, account sessions, or host connections. Import `@openbot/ui/styles.css` after brand
tokens and include the package source in Tailwind scanning. App-specific styles remain in
the application. The desktop TypeScript project includes the package source for CI checks.

The package also owns prop-driven feature UI: the complete sidebar and its scoped interaction
stores, account login and dock, server rail and invitation dialog, message rendering, composer
editor, attachment cards, preview renderers, agent setup, and reusable settings panels. Feature
exports use explicit subpaths such as `@openbot/ui/features/sidebar/Sidebar`. Shared display
models live at `@openbot/ui/data`. Source files are moved, not copied or re-exported from the
renderer. Tests remain in the renderer test harness and import the package directly.

The browser panel and live canvas also live in this package. Their typed `BrowserViewRuntime`
is required; the renderer supplies the desktop preload adapter or the web host adapter.
Shared sidebar activity and avatar mood functions use caller-supplied state. The conversation
stylesheet is exported as `@openbot/ui/features/conversation/conversation.css`; applications
import it in the same cascade position as the former renderer stylesheet. This file is an ordered
manifest of component styles in `features/conversation/styles/`. Preserve import order: later
surface and responsive rules override earlier component rules.

`@openbot/ui/features/marketplace/*` renders the Marketplace window: the Agents, Apps and Skills
tabs, and a page for each listing. It reads a typed `MarketplaceModel` and holds no data of its
own. The renderer's `marketplace-controller.ts` builds the model on the injected `MarketplaceCalls`,
and `MarketplaceModal` adds the connect and uninstall dialogs. `WorkspaceOverlays` creates one
`GitHubConnectorController`; the GitHub app page and Server settings › Connectors show the same
`GitHubConnectorPanel` from it.

`AgentSettingsPanel` owns the form draft, ordered save queue, avatar editor, and model controls.
Its renderer adapter owns persisted width and native memories, routines, skills, and tables,
which it supplies as content slots. `ConversationHeader` owns the header controls; its renderer
adapter owns context reads, capabilities, translations, and action error handling. Both shared
components receive typed props and callbacks. The shared-package Biome override rejects
application imports and direct desktop preload access. Boundary fixtures run with the focused
`scripts/ui-foundation-check.test.ts` test.

Desktop sidebar persistence stays in `sidebar-pins-storage.ts` and `sidebar-sections-storage.ts`.
The main conversation controller, application contexts, and platform adapters stay in the
renderer. Further extraction requires explicit runtime inputs for those dependencies. React
Native uses brand tokens and contracts, not these DOM components.
