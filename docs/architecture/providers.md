# Providers

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
per renderer port and per worktree, so a store inside `userData` started empty in each
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

## OpenCode and ACP

`src/backend/acp-connection.ts` owns ACP process transport. `acp-configuration.ts` owns
configuration and model discovery. `src/backend/acp-client.ts` owns session start/load,
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
supports only Go. So `isOpencodeModelUnusableWithStoredKey` in `src/backend/agent/model-catalog.ts`
drops the paid Zen models from `ModelCatalog.refresh` while OpenBot is the one supplying the key;
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
Migrations 17, 22, 23, 24 and 26 widen the table's provider `CHECK`. Migration 28 removes it, so a
new provider needs no table rebuild. `ProviderSessions.bindProviderSession` and the thread replay
accept only `AGENT_PROVIDERS` and reject other values before they write an event or a row.

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

The server has no usage reading, so the descriptor sets `reportsUsage: false`: the usage poll does
not start Gemini, the dock says usage is not reported, and a limit failure is shown as a turn error
instead of waiting for a usage notice. `GEMINI_REQUEST_FAILURES` in `src/backend/acp-client.ts`
names a rate limit or quota, an unavailable model, and a service failure from Google's status
text. Antigravity does not document these texts.

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

The v4, v5 and v6 base schemas are one codec, `provider-aware-codec.ts`. Each `v<N>-base.ts` passes
`createProviderAwareCodec` a frozen profile: the providers, the signed-in auth kinds and the agent
model charset. Nothing else differs between these versions. `provider-aware-codec.test.ts` holds
what each released profile accepts. Do not edit a released profile; a new provider needs a new
protocol version.

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

### Local provider switches

The Providers section can turn each built-in provider off on this computer.
`ProviderUseSettingsStore` saves the choices in `openbot-provider-use-v1.json`.
A missing file leaves all providers on. An unreadable or newer file stays unchanged.

`ProviderRuntime` filters off providers before CLI checks and model discovery. It also
refuses explicit connection and sign-in requests for them. The managed runtime loader
skips their executable version checks. Turning a provider on checks it again.

`AgentService` uses the model-assignment lock when it turns a provider off. It refuses
the change while an agent uses the provider. New model assignments use the same lock.
The switch is local IPC only; released Team API adapters stay unchanged. Remote
clients receive the host's filtered model list.


## Provider settings and the ACP registry

`AgentClient` remains the provider boundary. ACP session ownership, history replay, and turn
completion stay together. Boolean and select settings can include grouped choices. The client
processes configuration notifications while idle. Model and reasoning continue to use their
existing fields. Permission, access, and approval settings remain under OpenBot controls.

Additional overrides are stored in validated agent JSON, by provider identity. A custom ACP
identity includes its custom agent ID. Saved overrides are separate from the current descriptors
and effective values. Missing choices remain saved and have a reset action. Changes made during
a turn apply before the next turn. Reset has a durable refresh marker, so restart cannot restore
the old provider value. No SQL migration is required.

The ACP registry uses `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`.
Registry installation records are separate from saved custom-agent configuration. Native and npm
distributions use staged installation and published integrity data. A `uvx` entry requires `uvx`
on the host. An ACP initialization check runs before activation. Failed or cancelled preparation
keeps the previous command. Removal stops the idle ACP runtime and removes managed files only;
it keeps saved agent IDs, settings, secrets, workspaces, and conversations. Manual commands remain
available. Installation always targets the selected host.

## Pi

Pi uses its native `--mode rpc` interface. It does not use an ACP wrapper. Requests have IDs;
`agent_settled` completes a turn. A successful `prompt` response only accepts the prompt. Cancellation
clears queued work before abort. Session paths and the active conversation branch are preserved.
Models come from the running CLI. A small extension uses Pi's `registerMcpServer` interface to
register configured MCP servers and OpenBot tools. Secrets are supplied through process state,
not copied into the extension source.

Managed Pi archives come from official GitHub releases and use the published SHA-256 digest.
Sign-in opens Pi in a host terminal. Close Pi after sign-in to refresh models in OpenBot.
Remote clients must complete sign-in on the host. There is no separate Pi account screen.

## Muse

Muse uses the official `@muse-code/sdk` to run `muse serve` over MSP. The SDK is pinned to `1.4.2`;
newer SDK versions must meet the three-day dependency rule before adoption. The native integration
supplies `sessionMcp`, preserves native session identity, and reads durable items to recover missed
events before completion. A cached model list does not prove authentication. Setup can run CLI
login; an explicit Meta API key uses OpenBot's encrypted credential store.

Muse profile generation fails before the CLI starts. The pinned native host still starts inherited
MCP servers with `--disable-shell`, `--disable-write`, empty hooks, and session `mcpServers: {}`.
It cannot meet the tool-free profile requirement. Generate the profile with another provider,
then select Muse for the agent. The local echo test and synthetic MCP marker record this limit in
`.openbot-build/muse-check/profile-mcp.mjs` and `profile-mcp-report.json`; this is not a live model
authentication test.

Managed Muse downloads use the official stable-channel manifest and artifact SHA-256 values.
The CLI remains an optional download, outside the OpenBot package. OpenBot does not overwrite
provider account files or run upstream self-updaters against managed installations. Both Pi and
Muse use the existing process confinement boundary. Workspace-only mode fails closed on hosts
without confinement support.

## Protocol compatibility

Team API v7 adds Pi and Muse provider values. Released v1–v6 adapters remain unchanged. Older
clients do not receive providers they cannot decode. Custom agents already named `pi` or `muse`
remain valid; the names are reserved only for new custom-agent creation.

Optional `providers-v5` routes include the new runtimes and write-only provider keys.
`agent-session-settings-v1` adds read, set, reset, and an agent-ID-only invalidation event.
`acp-registry-v1` adds registry administration. Each administrative route checks the host role;
clients hide unsupported controls. MCP-over-ACP transport is outside this change.
