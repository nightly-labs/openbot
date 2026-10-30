# Providers

To add a provider, or to see how a provider signs in on a joined server, read
[Integrations and sign-in](integrations.md#add-a-provider).

## Built-in tool discovery

`agent/tool-catalog.ts` exposes eleven direct tools and three discovery tools to every adapter.
Claude uses its native question tool instead of `ask_user`. The direct tools are `ask_user`,
`attach_files_to_response`, `list_agents`, `send_message`, `search_memories`, `remember`,
`forget_memory`, `react_to_user_message`, `request_api_key`, `routine_no_update`, and
`routine_report_failure`. External plugin registration stays with each provider adapter.

`tool_search` uses local keyword matching. Exact names come first, then word matches, with stable
catalog order for ties. It returns five results by default and at most ten. It accepts `queries`, or
one `query` string, because models often send one string. Up to three strong results, an exact name or
queries that contain each word of the tool name without its namespace, include the original schema and guidance, so the agent can call them
without a describe step. Each model step sends the full context again, so one step less saves more
input than the added schema costs. A query word that is only in the namespace, or one shared verb
such as "read", does not make a result strong. The other results have a short description only. `tool_describe`
returns the original schemas for up to ten qualified names, plus guidance from
`agent/tool-guidance.ts`. Identical guidance appears once per response. The initial catalog lists
names without schemas.

`tool_call` accepts `{ name: "namespace.tool", arguments: { ... } }`. The router resolves only
original built-in names. It preserves the request, thread, turn, and call identifiers and the abort
signal, then enters the same dispatch as a direct call. Existing decoders, secure browser input,
approval cards, image results, cancellation, and message idempotency remain at their existing owners.
A discovery tool cannot call another discovery tool. Old direct calls still reach their handlers.

The visible definitions are part of the existing tool configuration fingerprint. A catalog change
uses the existing session replacement or resume path; it does not reset the agent or its visible
conversation. Claude builds its SDK MCP server from the same visible definitions. ACP, Pi, and Muse
receive them through the local MCP bridge.

`agent/developer-instructions.ts` puts stable rules first, profile and workspace settings next,
and memories last. Detailed browser, administration, routine, hosting, data, and visual guidance
loads through `tool_search` or `tool_describe`. Essential secret handling and untrusted-content rules stay in the
permanent instructions. Each rule has one place: the Vault, wait, and memory-selection details are in
their tool guidance or descriptions, and the teammate reply format and the rule against
acknowledgement loops come with each teammate message (`agent/delivery-content.ts`). ACP and Muse still insert these shorter instructions on each normal turn.
Retention after compaction is not assumed. Compaction thresholds are unchanged.

`bun run check:agent-context` measures the instruction text, the visible tool definitions, the
catalog, and the guidance in bytes, and fails when one of them grows. See
[Agent context budget](../development-checks.md#agent-context-budget). Schemas and guidance loaded
later add context and can add model steps. Provider prompts, external plugins, caching, billing, and
native model serialization are outside this measurement.

## History retrieval and replacement sessions

A replacement provider session receives a handoff of at most 32,000 characters, including headers
and message identifiers. The budget reserves 24,000 for recent messages, 4,000 for older excerpts,
2,000 for captured work steps, and 2,000 for instructions and references. Unused space can hold more
recent text. Large latest user and assistant messages keep their start and end. Excerpts are not
semantic summaries. Handoff construction stops reading pages when its packet is full and does not
start old provider processes to get work steps. Existing stored conversations and summaries remain.

Two deferred tools recover omitted text without model calls for search or summarization:

- `history_search` searches the calling conversation, with five results by default and ten maximum.
  Each excerpt is at most 400 characters. Its serialized tool result is at most 8,000 characters.
- `history_read` returns recent messages, a named message, or a page before a returned cursor.
  It returns ten messages by default and twenty maximum, within a 16,000-character serialized result.
  `nextOffset` continues a large message. With `includeWorkSteps`, `nextWorkStepsOffset` can be passed
  as `workStepsOffset` to continue a large or heavily escaped capture. Captures contain selected work
  steps, not raw provider reasoning or full tool results. Missing or corrupt captures do not block chat.

New captures use `provider-work-steps/v2` and the unique database session ID. Two providers can
use the same native session and turn IDs without sharing captures. Legacy capture files have no
ownership record. They remain on disk while their sessions remain recorded, but are not served as
history or handoff evidence. A new capture restores work-step access; saved chat text is unchanged.

The router requires an exact native-thread binding and the loaded client. It never falls back to
the personal conversation. Database reads check thread ownership and canonical conversation order.
The latest context-reset marker excludes earlier messages. Cursors name a stored anchor and the
current reset; supplied ordering values are not trusted. File reads are followed by another check
of reset, message existence, and message content. Channel history continues through `channel_history`
and its assignment checks. Messaging history stays within the current link's execution thread.

Claude model and effort changes use its live setters at the next turn, without replacing the
native session or restarting its query. Standing instruction or access changes retain the existing
refresh path. No-op profile saves do not unload sessions. Logs count provider-session starts by
reason and Claude configuration restarts, without conversation text.

Memory refresh behavior remains unchanged. The Codex fake-provider test proves that updated
instructions are sent on resume; it does not prove native model adoption. Claude prompt snapshots
stay off so they cannot freeze changed profile or memory text.

## Background memory review

`agent/memory-review.ts` reviews an agent's memories in the background. Each conversation has its
own count: the agent's own chat and each side thread. A review starts after 20 completed turns of a
conversation, after 15 minutes with no turn in a conversation that has 3 or more new turns, when
the user clears the chat, and when a side thread with new turns closes. Turns of channels,
messaging threads and routine runs do not count. A turn in which the agent changes its memories
itself starts the count again. A deleted side thread is not reviewed, and its running review ends.
The counts and the last reviewed message are in memory only; after a restart, a review reads the
latest messages.

The number of turns is a setting of the server that runs the agents: Server settings > General >
Memory review, with 10, 20 (the default) or 40 turns, or Off. An owner or admin of a joined server sets
it through `memory-review-v1` (see [servers.md](servers.md)). Main owns
`openbot-memory-review-v1.json` (`MemoryReviewPreferenceStore`) and passes
`memoryReviewInterval()` to the agent service, which reads it at each use, so a change applies from
the next turn. Off starts no review of any kind: not after turns, a pause, a clear or a closed side
thread. The counts continue while it is off, so the first turn after it is on again can start a
review.

The review is one profile-client generation without tools, on the agent's own provider. It uses
the provider's default model (`defaultProviderModel`) when that model is listed and its standard
input price in `usage-pricing.ts` is lower than the price of the agent's model, with that model's
default reasoning effort. Otherwise, also when a price is not known, it uses the agent's own model
and reasoning effort. Benchmark v2 measured the review quality on `claude-haiku-5-5`. The review
does not reuse the main chat's prompt cache: its prompt and tools are not the chat's, so its input
is billed at the full rate. It reads the agent's profile, its memories, and the conversation since the last review and after
the latest context reset, with the side-question transcript budget. The prompt holds every
essential memory and as many searchable memories as fit 12,000 characters: first those that share
the most words with the reviewed conversation, then the newest. It states how many are not shown,
so a review stays the same size at any memory limit. Chat and memory text pass through
the secret redaction before the prompt is made. The model answers `add`, `update` and `forget`
operations as JSON. `AgentMemories.applyReview` commits them as one turn through the checks of the
memory tools: the memory limit, the essential budget, duplicates and the user's selections. A
review does not change a memory that the user wrote or whose inclusion the user chose, a memory
whose text changed after the review read it, or a memory whose text the redaction changed. A memory
clear during the review drops all of its changes.

Only one review runs at a time, and only when a profile-client slot stays free for the user. A
review that cannot start waits, and starts when the running review ends or at the next turn. A
clear's review that waits for longer reads the new chat, not the chat that the clear ended. A failed generation or an answer that is not JSON is logged
and shows nothing. A usage limit is skipped silently and does not mark the model. The changes show as a
memory-changes line with its own `memory-review-` turn id, in the conversation that was reviewed.
While a turn of that conversation runs, the line waits for the turn to end. Agent deletion and service stop end a running review.

## Compaction ownership

Codex and Muse complete explicit compaction through turn events. Pi completes it through the request
response. Claude manages compaction natively. ACP and custom ACP expose no explicit compaction
operation to the OpenBot scheduler. Unsupported or native-managed clients cannot reserve its queue
for a no-op request. Request completion clears the hold and keeps the minimum-growth guard.

Antigravity reports its context fill but has no compact operation, so its flavor sets the `handoff`
mode. `ThreadLifecycle.rotateProviderSession` saves the work steps, closes the session, and starts a
new session on the same public thread. Its first turn takes the history handoff, as after a provider
switch. The agent, thread, workspace and messages stay. Only the agent's own chat rotates: an
execution thread has no handoff. The harness also compacts by itself; that only lowers the reported
fill.

Codex retains the 80% threshold based on its last reported token usage and context-window size.
Cumulative account usage is not context occupancy. A missing report is not zero usage. No fixed
200,000-token context window, per-turn model summary, or new automatic model call is added.

The design uses Hermes's on-demand discovery, stable instruction ordering, and bounded local
history recall as references. OpenBot retains each native provider's session and compaction rules.

## Model catalog

`ModelCatalog.refresh` (`src/backend/agent/model-catalog.ts`) reads `model/list` from each running
CLI the same way. It has no provider branch. A provider whose list differs sets `catalog` on its
driver in `src/backend/provider-drivers.ts`: Codex pages its list and reports a Fast tier, Claude
Code names its models itself, OpenCode drops models that the stored key cannot use and keeps its
free tier when discovery fails, and a custom agent gets the full request timeout. A new provider
adds its rule there, not in the catalog.

## Provider CLI updates

The runtime manager offers the latest upstream release of each provider CLI. It checks at startup,
every hour, and when the user selects `Check for updates` (`provider-runtime-releases.ts`): GitHub
`releases/latest` for Codex and Pi, the npm `latest` tag for Claude, OpenCode and Cline, `x.ai/cli/stable`
for Grok, the `muse-stable` channel for Muse, and the ACP registry entries `antigravity-acp` for Gemini and `cursor` for Cursor. The version in `native-runtime.lock.json` is what a first install uses before a check has
answered, and Bun, which is a tool runtime and not a provider, stays on it.

Every upstream download is checked against its source's own hash: the GitHub asset `digest` for
Codex and Pi, the manifest `checksum` for Muse, and npm `dist.integrity` for Claude, OpenCode and Cline. x.ai and the ACP registry publish no hash,
so a Grok, Gemini or Cursor release is trusted on TLS alone. A Gemini release must stay on
`dl.google.com/agy-extensions/releases` and keep the pinned command name. A Cursor release must use
the pinned `downloads.cursor.com/lab` path for its target, with a build that starts with the
registry date, and keep the pinned command. An upstream install writes `openbot-install.json` with the SHA-256 of each
file it installed, and every start verifies that record and the binary's `--version` before the
install is used. The newest version in the store that verifies is the one that runs.

`provider-runtime-blocklist.json` on `main` names versions no installation may offer. It stops a
broken upstream release without an OpenBot release. It suppresses an offer only: it does not remove
a version a user already installed. A list that cannot be read blocks nothing.

The `Provider CLI canary` workflow (`.github/workflows/provider-cli-canary.yml`) finds a broken
release before many users install it. Every six hours it reads the newest release of each provider
for each target, installs the newest OpenCode through `ProviderRuntimeManager`, and runs the
conformance cases on it with the free `opencode/big-pickle` model and no account
(`bun run test:provider-cli-canary`). The run fails when the install is not the version that an
update installs now, so a failed release read cannot make it test the pinned CLI. Each turn fails
after five minutes, so a hung CLI still writes the report. The second failed run in a row opens one
issue, and a run that passes closes it. An issue that a person closes stays closed until the canary
passes and then fails two times again. The other
providers need an account, so the canary only reads their releases; `test:provider-conformance` runs
the same cases on each ACP driver over a fake agent.

The provider runtime holds new turns while it installs and activates that managed executable. It
keeps the previous client until the candidate is ready; activation failure removes the rejected
artifact and preserves the old runtime, so a release that does not start leaves the last working CLI
in use. Download status stays `finishing` until activation succeeds.

CLI resolution prefers an explicit `OPENBOT_*_PATH`, then the installed managed copy, then an
automatically discovered system CLI. Updates never run the system CLI's updater. An explicit path
suppresses managed update offers. Startup uses the same selection and reads the executable's version.
On macOS and Linux, discovery looks in the folders of the login-shell `PATH` (`loginSearchPath` in
`src/backend/cli.ts`, shared with ACP and custom agents and cached for 60 s), then in fixed user
folders: `~/.local/bin`, `~/.npm-global/bin`, `~/.volta/bin`, `~/.bun/bin`, the pnpm home, Homebrew
and the system folders. nvm folders are not searched, because only nvm's shell setup selects a
version. The login shell is `$SHELL` when it is a known POSIX shell or fish; otherwise macOS uses
`/bin/zsh`. The version probe and each process that OpenBot starts for the CLI (app server, ACP,
Claude sessions, sign-in and sign-out) start with the resolved `launchPath`: the login-shell
folders, then OpenBot's own, then the CLI's folder for a system copy. An app that Finder starts can
then run a `#!/usr/bin/env node` CLI. A CLI that exists but does not start reports whether the
managed copy or the user's copy failed.

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
one it falls back to until the pinned one arrives -- and collection keeps anything stamped within two
days. When the computer has been awake for one check interval (one hour), the update check keeps
only what was stamped within three hours. So a version another instance or another
worktree's pin still runs is not removed; a collection that fails, as it does on Windows for an open
binary, never stops startup.

A provider that is off in this profile runs no CLI, so the manager does not stamp its versions. Pi
counts as in use while a key-only provider that runs on it is on. Its
provider page in Settings offers Remove download (#3321), which removes every version of that CLI and
this profile's partial downloads of it, and leaves accounts and sign-ins alone. It is refused while
the provider is on, while its download runs, and for a provider with an explicit CLI path. The same
age rule keeps a version another instance stamped, with one change: the manager remembers its own
last stamp of each directory, and a directory whose mtime is not later than that stamp counts as
unstamped. Otherwise the stamps this instance wrote before the user turned the provider off would
keep it for hours. A sibling stamp older than this instance's last one is hidden by it until the
sibling's next check stamps again. Each version is moved aside before it is deleted, so a version a
program holds open stays whole, and the removal then reports that it did not finish. The manager
stamps the version it activates, so an install it made in the same session is its own. Because a
provider that is off is not stamped, a sibling can collect its version; turning the provider on
reads the store again when that version is gone. Turning the provider on later downloads the CLI as
on first use.

### Managed provider updates

The main process offers the version that the section above selects. The lock pins each provider
for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and `win32-x64`; a platform with no pinned artifact reports
that it is not supported instead of offering a download. An older managed installation is display
metadata until the offered runtime passes the existing download and install checks. Runtime snapshots carry the previous version and an optional `availableVersion` through the
preload decoder. Cancellation and failure preserve the previous installation and its update offer.

After an app upgrade, main updates the managed CLIs with no offer (#3164).
`openbot-provider-cli-app-version-v1.json` in `userData` keeps the app version that last started the
update checks. A different or missing version calls `startUpdateChecks({ updateInstalled: true })`.
Until the first check starts the downloads, `getStatus` does not offer the CLIs that it will update. That check then starts the
download of each managed CLI that has a newer version, before it sends its status, so the renderer
announces no offer. A CLI the user installed, an explicit path and an off provider keep the normal
offer path. The renderer shows a notification for such an update only when it fails, with a Retry.

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
`turn/started` `ContextCompaction.claimTurn` takes away from the agent - therefore makes the
update wait, as a restart the user asked for waits, before anything is downloaded. Main shows the
wait as a `downloading` runtime with no progress and the message `status.provider.updateWaiting`;
its Cancel aborts the wait. New turns of the provider wait for the update from the start of the
wait, so a busy provider still gets a moment without turns. No turn may start on that provider until the new client is ready: the drain
scheduler skips an agent whose provider reports `isReplacingCli`, before it can reschedule the
delivery, and `onProviderResumed` schedules the held deliveries when the replacement ends, after a
failure as well as after a success.

## OpenCode and ACP

`src/backend/acp-connection.ts` owns ACP process transport. `acp-configuration.ts` owns
configuration and model discovery. `src/backend/acp-client.ts` owns session start/load,
streamed messages, permissions, tool bridging, and cancellation. `grok-client.ts` supplies xAI
login and billing hooks. The OpenCode driver starts `opencode acp` on the runtime OpenBot pins and
downloads, or on a CLI the user installed. Profile clients deny tool permissions.

The pinned runtime is OpenCode 2 (`@opencode/cli`). Its platform tarballs carry no licence file, so
the stage step copies `LICENSE` from the `opencode-ai` tarball that `licensePackage` in
`native-runtime.lock.json` names. Every OpenCode install on the computer shares
`~/.local/share/opencode/opencode.db`. When OpenCode 2 migrates a database of OpenCode 1, it adds
`session_v2` and keeps `session`, so OpenCode 1 can still open it. A database that OpenCode 2
creates has no `session` table, and OpenCode 1 then refuses to start with "Database is not empty and
has no session table" (OpenCode issue #53221); `ProviderRuntime` replaces that exit text with
`error.provider.opencodeDatabaseNewer`. OpenBot does
not move OpenCode to a separate database, because the threads would lose their sessions. OpenCode 2
differs from OpenCode 1 on the wire in three places that `acp-client.ts` handles: a missing session
is `-32602` "session not found: <id>" instead of an `-32603` service failure; `session/resume` can
fail with `ServiceUnavailableError` while the CLI starts (OpenCode issue #57204), so it is tried once
more after two seconds; and a model name starts with the provider id, not its name, so
`openCodeModelName` restores the group name.

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
supports only Go. So `isOpencodeModelUnusableWithStoredKey` in `src/backend/agent/provider-models.ts`
drops the paid Zen models from `ModelCatalog.refresh` (through the OpenCode driver's
`catalog.usableWithStoredKey`) while OpenBot is the one supplying the key;
with no key stored those models can only come from the user's own OpenCode sign-in, which does
buy them. Neither `/models` endpoint authenticates, so entitlement cannot be read back and the
split is a product rule rather than a check.

The CLI reports no Go quota over ACP. `readOpenCodeGoUsage` (`src/backend/opencode-usage.ts`)
sends `opencode.ai/zen/go/v1/usage` the key the CLI uses. A saved key is the only key: the CLI
applies config `options.apiKey` last. With no saved key, it reads the CLI's own keys in the order
T3 Code uses: the active OpenCode Console row (`integration_id = 'opencode'`, `type: "key"`, no
self-hosted `metadata.server`) in the `credential` table of `$XDG_DATA_HOME/opencode/opencode.db`
(or `OPENCODE_DB`), then the Go key: the `opencode-go` key of `auth.json` (or `OPENCODE_AUTH_CONTENT`,
which also skips the database), or `OPENCODE_API_KEY` when that has none (#3548). A 401 or 403 on the
Console key tries the Go key. The
database is opened read-only with a 100 ms busy timeout, because Effect cannot interrupt a blocked
SQLite call. `scripts/opencode-go-usage-e2e.ts` covers it.

`PREFERRED_MODEL_ORDER` (in the same file) reorders that catalog, because a provider with no
`defaultProviderModel` runs the first model of its list and OpenCode reports the third-party
services the user signed in to before its own — so the fallback used to pick a model behind a token
OpenBot can neither see nor refresh. `opencodeModelRank` sorts free models first with Muse ahead of
the rest, then OpenCode's own paid models, then everything behind a separate sign-in. Inside one
tier the newest version comes first. The sort is stable, so the CLI's order stays between models of
one version.

Free means a display name ending in "Free", or an id in a short explicit list
(`opencode/big-pickle`): `model/list` carries no price and neither Go endpoint authenticates.
`isFreeOpencodeModel` in `packages/contracts/src/agent-providers.ts` is shared with the picker badge in
`packages/ui/src/components/provider-model-options.ts`, so a badge and a default cannot disagree
about what costs money.

A keyless OpenCode still lists models whose provider has no sign-in. OpenCode 2.1.1 fails a turn on
one with `-32000` "provider authentication required" and no provider ID. `OPENCODE_ACP_FLAVOR`
maps that code to `error.provider.opencodeAuthRequired`, which names the provider from the model ID
before its first `/` and lists the fixes: a Free model, a Go key, or `opencode auth login`.

#### Turns of a background subagent

OpenCode 2.2.0 sends session updates only for the execution that a `session/prompt` starts. When a
background subagent ends, OpenCode answers its result in a turn of its own (a `synthetic` row with
`source: subagent` in its store), and no update of that turn reaches the client (#3406). The flag
`unsentBackgroundTurns` of `OPENCODE_ACP_FLAVOR` turns on the recovery in `acp-client.ts`:

- A tool call that ends with `rawOutput.metadata.status` "running" and a `sessionID` started a
  background task. OpenBot then watches the session for 30 minutes, and longer while it changes.
  The idle pool does not close a watched session, because a closed one never reports the result.
- Every 2 seconds, when no prompt runs or opens, OpenBot reads `session/list`. When the session's
  `updatedAt` changes, it sends `session/load` with the session's own MCP servers, and collects the
  replay apart from live updates until the load answers, also after the request time limit. A
  prompt waits for the load meanwhile. A failed load is tried again at the next poll.
- The client keeps the ACP `messageId` of each message with text and the ID of each tool call that
  the chat showed. The replay's entries after the last shown one, the updates of the tool calls
  that are still open, and the added text of the message that the turn shows last go through the
  live update path in a turn with `unprompted: true`. OpenCode stores a message when it starts and
  its text when the step ends, so a replay can find it empty first. As for Claude
  (#1904), no delivery attaches to that turn, and a message sent meanwhile fails with
  `ProviderTurnActiveError` and waits in the queue.
- OpenBot ends that turn when the session sends nothing new for 15 seconds and no tool call is open,
  or after the stall limit while one is. A step that writes for longer can split one turn in two;
  nothing is lost. A stop cancels the turn and marks its open tool calls as stopped. For 30 seconds
  after any turn that does not complete, a replay marks new entries as shown and does not show
  them, because OpenCode can go on with a stopped turn (#2858).

The watch is in memory. A background task that ends while OpenBot is closed, or after OpenBot
loaded the session again, shows only in OpenCode's own store.

#### Text of two steps

OpenCode 2.2.0 gives the message of each step its own ACP `messageId`. With `messagePerId`, text of a
new `messageId` with no tool call before it starts a new paragraph of the same answer, so the text
of two steps does not show as one line. As for every ACP agent, text before a tool call is
commentary, which the chat folds into the turn's thinking.

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

The server offers its Claude and GPT models only to a client whose `initialize` `clientInfo.name` is
`zed`, `xcode`, `jetbrains.*` or `android studio*` (`supports_third_party_models` in 1.4.3). Other
clients get only the Gemini models. So `ANTIGRAVITY_ACP_FLAVOR.clientInfo` sends the name `zed` and
the title `OpenBot`. The server also sends the name and version to Google in its User-Agent
(`_surface`), so Google sees OpenBot's requests as `zed/0.1.0`.

Sign in is an ACP `authenticate` call with `oauth-personal`, in a separate process
(`src/backend/acp-sign-in.ts`). On Linux, OpenBot reads the Google sign-in link from the
server and opens it with the desktop browser. The server browser launch is disabled for this
process so the page opens once. A failed browser launch gives an actionable error; the OAuth
link and browser error details are not logged. Other platforms let the server open the browser.
A valid saved Google token answers `authenticate` with no browser page. So a Reconnect of a
connected Google sign-in, with no saved key, first calls ACP `logout` when `initialize` advertises
`agentCapabilities.auth.logout` (runtime 1.4.1 and later). The Google page then opens. The token is
shared by every OpenBot profile on the computer, so they all sign out. A Reconnect is refused while
a Gemini turn runs. When the sign-in stops after the logout answered, OpenBot stops the old client
and reports Gemini signed out; a failure keeps its own reason. A status probe must never call `authenticate`. The serving client does not call it.
OpenBot checks authentication through model discovery (`session/new`), not the auth methods
advertised by `initialize`. The runtime can answer "Authentication required", which OpenBot
reports as sign-in required. In runtime 1.3.0, a saved OAuth method with no valid token can also
start interactive authentication during `session/new`; this can leave the probe waiting until
its existing deadline. Runtime installation alone does not confirm authentication.
On Ubuntu 24.04, install a desktop browser and `xdg-utils` before sign-in. The Google
callback uses `127.0.0.1` on the host, so complete sign-in in a desktop session on that same
VM. A browser on another computer cannot complete this loopback callback. A server with no
desktop can install and start Gemini, but cannot complete the interactive Google sign-in.

The local Settings > Providers screen offers Connect for both a managed runtime and an
external runtime. Gemini has no device-code flow, so a remote host signs it in on a page in its
own browser. A Linux host advertises `provider-host-sign-in-v1` (Team API v7 only). Connect sends
`start` to the host. The host runs the same sign-in as its own Connect, and opens the Google link
from the CLI in a private tab of its browser. The client polls `status`, shows that tab through
the live view (`browser-view`), and closes the dialog on the `result`. The Google callback goes to
`127.0.0.1` on the host, so the host's browser completes it. No route carries the link or a
credential, and every route requires an owner or admin. A host on another platform does not
advertise the capability; open OpenBot in the host's desktop session to connect it there. A runtime status of "Runtime installed" means only that the files are
available; "Connected" requires a successful provider check. A known authentication or launch
error takes priority over runtime readiness.

#### Download and external runtime recovery

Issue #1776 reports an HTTP 404 for the official 1.3.0 Linux archive from an OVH IPv6 pool,
and HTTP 200 over IPv4. This cause is not confirmed: checks from another host on 2026-10-10
returned HTTP 200 over both families. An HTTP failure occurs before archive extraction or
ACP startup; it is separate from browser sign-in and missing runtime files. OpenBot keeps
the download error and Retry action and does not change the host's network settings.

For an affected host, an operator can compare bounded requests to the exact failing URL
with `curl --ipv4 --head --connect-timeout 10 --max-time 30 <url>` and the corresponding
`--ipv6` command. If IPv4 works, download that same official archive with
`curl --ipv4 --fail --connect-timeout 10 --max-time 300 --output <new-archive-path> <url>`.
Verify the archive against a trusted release checksum before extraction. This affects only
that request. Do not disable IPv6. The report's claimed `::1` kernel requirement was not
confirmed in the ACP Python source; a native harness requirement remains unverified.

An external installation must preserve this layout (1.3.0 is an example):

```text
/var/lib/openbot/antigravity-acp-1.3.0/
  antigravity-package.json    {"version":"1.3.0"}
  bin/
    agy_acp_server.par
    localharness_external
```

Both programs must be executable by the OpenBot host user. Set
`OPENBOT_ANTIGRAVITY_PATH=/var/lib/openbot/antigravity-acp-1.3.0/bin/agy_acp_server.par`
in that process's environment and restart OpenBot. The variable names the executable, not
the directory. OpenBot requires the version manifest two levels above it; extraction alone
does not create that manifest. An invalid override remains an error: OpenBot does not replace
it with the managed runtime. Managed updates do not change the explicit override.

The server runs confined; `antigravityStatePaths` gives it `~/.gemini/antigravity-acp` and
`~/.gemini/artifacts` and protects its settings files. On macOS, runtime 1.4.0 and later keep the
Google sign-in in the login Keychain only when a test item can be written there at start, and a
confined process cannot write the Keychain (#2988). So every Antigravity process, the sign-in
included, gets `AGY_ACP_FORCE_FILE_STORAGE=1` and keeps the token in
`~/.gemini/antigravity-acp/acp_token.json`, as on Linux and Windows. A token that an earlier
version saved in the Keychain is not read, so the user signs in again once. Migration 22 adds `antigravity` to
`projection_provider_sessions`.

From 1.4.0 the server keeps the token, `settings.json` (which names the sign-in method) and its
conversations in `$GEMINI_HOME/antigravity-acp`, with `~/.gemini` when the variable is not set. So
Gemini can hold more than one account: each account after the first gets `GEMINI_HOME` set to its
own folder (`antigravityReadsGeminiHome` gates the rows, the sign-in, the checks, the usage reads and
the agent start), and `antigravityStatePaths` confines its process to that folder. Each new session
leaves a conversation database in that folder, so a usage read of an account with no agent process
starts no process: the account shows its reading from the sign-in check. The sandbox cannot create folders in a new account's home, so OpenBot makes them.
The account sign-in is the same ACP `authenticate` call as the first account's; a Reconnect calls
`logout` first. So a Reconnect refuses while an agent on the account runs a turn, and it stops the
account's idle agent processes, which keep the old token. A saved Gemini API key belongs to the
first account: an account process never gets `GEMINI_API_KEY`. The server reports no email and the token file holds none, so OpenBot cannot see
that two accounts are the same Google account. A joined server relays the account's sign-in to the
client's browser with `provider-account-relay-v2`. A host with only `provider-account-relay-v1`, which
names Codex and Claude only, signs the account in through the live view.

From 1.4.1 the server answers a prompt that starts with `/usage` itself, without a model turn: it
reads the Google account's quota summary and sends one Markdown answer. The driver's
`readRateLimits` sends it in a session that no thread owns (`privatePrompt` in
`src/backend/acp-client.ts`). Each process keeps that one session for every read, because each new
Antigravity session leaves a conversation database in `~/.gemini/antigravity-acp/conversations`,
also after it closes. `src/backend/antigravity-usage.ts` reads one group of the answer's
"Quota Limits" section into the windows. Google can give a model a group of its own, such as Gemini 4
Argon, so a read for a model takes the group whose "Models within this group" list names it (#3055),
and a model that no group names has no reading. The dock's read, with no model, takes the "Gemini
Models" group. Each reading also carries every group by name and models (`AccountUsageLimit.groups`),
so the usage popover shows one line per group and the composer notice uses the group of the agent's
model (`usageGroupForModel`). The ring stays on the reading's own group. The Team API codecs do not
send `groups`, so a remote client shows the one reading. The Claude and GPT models that Antigravity
also runs share another limit, so `accountUsageCoversModel` keeps them out of the plan-limit hold. An
older runtime, an
API key sign-in ("Not applicable for current authentication method") and an answer that does not
parse give no reading. A saved Gemini API key comes before the Google sign-in, so the provider
status sets `apiKeyInUse`, and the API key section of the Gemini provider page says that the key,
not the plan, serves the turns. The dock shows no Gemini row then, because it has no reading.

A limit failure stays a turn error even though the descriptor sets `reportsUsage: true`, because
many Gemini setups have no reading to explain it. `GEMINI_REQUEST_FAILURES` in
`src/backend/acp-flavor-antigravity.ts` names a rate limit or quota, an unavailable model, and a
service failure from Google's status text. Antigravity does not document these texts.

Antigravity 1.3.0 reports a spent per-user quota as answer text, `Usage Limit Reached` and Google's
reset time. The flavor shows it with `error.provider.antigravityQuotaReached`, not the rate-limit
text, because the quota resets in days. The server names no bucket, so the message says that the
limit can be for one model and that the plan's usage page can still show room.

Antigravity 1.3.0 and later send ACP `usage_update` after each model step: `used` is the size of
the last model call, and `size` is the model's context window. The adapter turns it into
`thread/tokenUsage/updated`, also after a turn that OpenBot already ended. 1.2.1, the pinned
first-install version, sends none, so the ring stays hidden until the runtime updates. The update
has no category breakdown.

Antigravity 1.4.3 also returns `usage` from `session/prompt`: the tokens of that prompt only, measured
from the session's total at the turn's start. A restored session starts from its saved total.
`src/backend/agent/usage-collection.ts` books each prompt result as its own counter (`promptId`, because
a delivery that runs again keeps its turn ID) and adds `thoughtTokens` to the output. 1.4.1 and earlier return no `usage`.

Antigravity 1.3.0 keeps `session/prompt` open until its harness reports
`STATE_FULLY_IDLE`. A background task can thus keep a turn open after answer text
arrives. The adapter streams that text at once. A later tool or thought changes
the same message to commentary. It does not use a quiet period or a usage update
as proof that the turn ended.

Stop sends `session/cancel`, ends the local turn, and saves unfinished tool calls
as interrupted. Before the next message, `session/resume` rebuilds the harness
with the same session ID and saved history. A failed restore keeps that session
available for another attempt. This does not change Antigravity's task database
or provide early turn completion while its background tasks continue to run.

Team API v1–v4 do not know `antigravity`. The host hides Gemini agents, models, status, and
sign-in state from peers on those versions, and the `providers-v1` routes omit it. Team API v5
carries Gemini, and the `providers-v2` runtime routes let an owner or admin download or cancel the
host's Gemini runtime. Gemini signs in through a browser on the host. The `provider-host-sign-in-v1`
routes let an owner or admin start that sign-in and see the page through the live view.

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

The CLI reports no usage over ACP. The driver's `readRateLimits` (`src/backend/cursor-usage.ts`)
sends the request that the CLI sends itself, `aiserver.v1.DashboardService/GetCurrentPeriodUsage`
as Connect JSON to `https://api2.cursor.sh` or `CURSOR_API_ENDPOINT`, with the CLI's access token.
The token comes from where the CLI keeps it: on macOS the login Keychain item `cursor-access-token`
(account `cursor-user`), read with `/usr/bin/security` because the CLI writes it with that tool,
then `~/.cursor/auth.json`; on Linux `$XDG_CONFIG_HOME/cursor/auth.json` or
`~/.config/cursor/auth.json`; on Windows `%APPDATA%\Cursor\auth.json`. Cursor does not document
this API. `autoPercentUsed` (Cursor's own models) fills the primary window and `apiPercentUsed`
(all other models) the secondary one, both for the billing cycle; the dock names them by slot for a
`cursor` row, because both windows have the same length. A plan with only `totalPercentUsed` fills
the primary window. The reader also sends `GetPlanInfo`: on a merged plan (`isMerged`), such as an X
subscription, the included usage covers Grok and Composer only, so `totalPercentUsed` alone fills the
primary window and the dock shows no other models window, as the Cursor app does. The Cursor app
keeps the split for a merged Enterprise team plan; the reader cannot see the membership type, so it
does not. That merged total is the Grok plan quota, so the reading sets `sharedQuotaWith: "grok"`
(not sent on the Team API): the page rail then shows the Grok ring alone when Grok has one. Its
hover card lists the Cursor reading too, and the ring draws the reading with the least left. A failed `GetPlanInfo` keeps the split. No token, a 401 or 403, or no percentage gives no reading. The dock poll calls
`readCursorUsage` directly, as it does for OpenCode, so it does not start the CLI for a reading.
`scripts/cursor-usage-e2e.ts` covers it.

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

The v4, v5, v6 and v7 base schemas are one codec, `provider-aware-codec.ts`. Each `v<N>-base.ts` passes
`createProviderAwareCodec` a frozen profile: the providers, the signed-in auth kinds and the agent
model charset. The v7 profile also raises the capability limit from 64 to 128 (`v7-base.ts`).
Nothing else differs between these versions. Do not edit a released profile.

Team API v8 opens the profile: `providers` and `authKinds` are `"open"`, so any id that matches
`OPEN_PROVIDER_ID` (`^[a-z][a-z0-9-]{0,63}$`) passes, and each provider status row can carry a
`displayName` of up to 80 characters (`v8-base.ts`). The codec still rejects a malformed row. A
provider added after v8 needs no new protocol version. The `providers-v8` routes
(`/v1/admin/providers/v8/*`) carry the runtimes as a keyed list, not as one fixed object.

The host hides a provider from a peer below v8 when that protocol's frozen list does not have it
(`FROZEN_PROVIDERS` in `src/main/team-api/provider-visibility.ts`). So a new provider is hidden
from old peers with no change there. Do not edit those lists. A key-only provider
(`KEY_ONLY_PROVIDERS`, now Inception, DeepSeek and OpenRouter) is not in any frozen list, so a v8
peer is the first to see it. The `providers-v8` key routes read, set and clear its key. A key set
there starts the host's Pi download when Pi cannot start, and does not wait for it. Until Pi is
ready no process uses the key, so the route saves only the key; the provider is checked again when Pi
is ready. The `providers-v5` and `providers-v1` key routes refuse its key.

A v8 client keeps the agents of a provider that its build does not know (`ForeignProviderId`,
`AgentProviderRef`). The agent stays in the list and chat works, because the host runs it. The
provider and model pickers show the agent disabled, with "Update OpenBot to use {name}" and the
neutral `unknown` logo. They do not reset the agent. The model picker and the backup models leave
out the models of that provider. Host types (`AgentProviderId`, the database, the drivers) stay
closed.

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
values. `customAgents.check` starts the program in a temporary folder, sends `initialize`, opens one
`session/new` there with no MCP servers to read the model names, and stops its process group. A
failed `session/new` (an agent that needs sign-in first) gives no models and does not fail the
check. The registry install check (`acp-registry-install.ts`) sends `initialize` only. The scan (`src/backend/acp-agent-scan.ts`) looks up the preset names on the
login-shell `PATH` and in the user's folders, and never starts a file. An agent and its check start
with the `PATH` that its command was looked up in (`agentLaunchPath`): the absolute folders of the
login-shell `PATH`, then those of OpenBot's own, so an app that Finder starts can still run a
`#!/usr/bin/env node` agent. A `PATH` saved on the agent wins. Claude agent sessions start with the
same `PATH`, so their Bash tool and hooks find the user's tools; an `env.PATH` in the Claude settings
wins. The agents run confined with no state paths. Migration 23 adds `acp` to
`projection_provider_sessions`. The host hides `acp` agents, models, status, and sign-in state from
peers before protocol 5, and the `customAgents` IPC group is local only.

A custom agent can have a usage prompt (`usagePrompt`, "Usage command" in the form), one line such
as `/usage`. `customAgents.usage` asks each agent that has one: `ProviderRuntime.customAgentUsage`
sends it through `readUsageText` on the agent's model list process, in the session that no thread
owns (`privatePrompt`). The answer is redacted and kept to `CUSTOM_AGENT_LIMITS.usageAnswer`
characters. OpenBot does not read a percent from it, so `acp` keeps `reportsUsage: false`: the rail
shows the agent's logo with no ring, and its hover card shows the text. The renderer polls with the
plan usage interval, only while the local server is active. One read runs at a time, and a read from
the last minute answers the next request. While `acp` is released, the read returns the last answers
and starts the router again only when an answer is older than an hour or its prompt changed. A read
that times out cancels the prompt in the agent. A prompt that the agent does not answer itself is a
model turn on each read. The registry install result of `acp-registry-v1` has no `usagePrompt`, so
the summary check accepts a summary without it. An older build drops `usagePrompt` from `custom-agents.json`
the next time it saves the file. An instance transfer does not carry it, because the import never
saves a custom agent.

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

### Backup models and failover

An agent keeps an ordered list of backup models (`AgentBackupModels`, at most 8) in `agent_json`.
The settings page, the admin route `agent-backup-models-v1`, and the `update_profile` tool set it.
When the list is automatic, `UsageLimitGate` and `AgentService.#usageLimitMove` move the agent to the
first ready model in the order that no hold covers. `usageLimitReturn` keeps the model the agent
left, and the agent goes back to it when its hold ends. A model the user picks drops the return.

Two holds move an agent:

- A plan usage limit holds the queue of every agent on that provider account and model until the
  reset. A usage reset that the user starts also ends it (see [Usage reset credits](#usage-reset-credits)).
- A provider error holds nothing. `TurnLifecycle` checks the turn's error with `classifyFailure`.
  The causes are `billing`, `provider_unavailable`, `rate_limit`, `authentication`, `network` and
  `timeout`. When the turn did no work yet (`!acted`) and the agent has a ready backup, the turn's
  messages go back to the queue and `UsageLimitGate.failed` passes over that model for 10 minutes.
  The next drain moves the agent, and the turn runs again on the backup with no error banner. The
  hold also ends when a turn on the model completes. A restart clears the holds, so the first drain
  after it goes back. The return is marked `cause: "provider-error"`, so the notes read
  `model-switch:provider-error` and `model-switch:provider-error-ended`.

A turn that wrote text or ran a tool fails with its error, as with no backup. Tasks, channel tasks,
a refused `turn/start`, and a provider that fails to start do not fail over. A message runs again at
most once for each model that failed it, so a move that cannot happen shows the error on the next
failure; the check for a ready backup runs again when the turn ends.

### Usage read pacing

Each desktop window, web tab and phone polls the plan usage every five minutes, and each poll reaches
the host. A usage endpoint allows few requests an hour for each login: Claude's is shared with Claude
Code and answers HTTP 429 for an hour or more when a client asks too often. So `UsageReadGate`
(`src/backend/agent/usage-read-gate.ts`) paces the reads of each provider's own sign-in in
`ProviderRuntime.usage`, and of each account after the first in `ProviderAccounts.usage`. One read runs
at a time; a request that comes during it waits and takes its reading. A reading answers for four
minutes, a little less than the poll, so one view still gets a new reading at each poll. After a failed
read, the next one waits 5 minutes, then 10, 20 and 40, up to an hour. Between reads and during the wait,
the last reading stays on the rail, also when one of its windows has reset.
A window that resets after the last read starts a read before the four minutes end, but not during the
wait after a failure; a window that had already reset when the provider sent the reading does not.

A read outside the poll of the provider's own sign-in, with the dock's model, also counts: when Codex
starts, its reading replaces the kept one and the next poll does not read again. The read after a usage
limit has no model, so for a provider whose limits depend on the model it resets the gate, and the next
poll reads. These reads, and the reads of a usage reset, are not paced. A credential change, another
login, a sign-out, turning the provider off or a new key resets the gate and forgets the kept reading and
reset credits, so the next poll reads at once and no view shows the old login's reading; a read that
started before the reset does not set the next read time. An account check or a usage reset of an
account after the first also counts as a read.

The values follow t3code (one refresh in five minutes for each host, one at a time) and openusage (5
minutes, doubling up to an hour). CodexBar and openusage first wait for `Retry-After`; the Claude Agent
SDK and the Codex app-server do not give OpenBot that header, so the gate uses only the doubling.
`scripts/usage-read-pacing-e2e.ts` checks the gate with a fake Codex.

### Usage reset credits

Codex can give an account usage reset credits: one restores the spent usage limits of the account at
once (issue #2859). `account/rateLimits/read` counts them in `rateLimitResetCredits.availableCount`,
and `account/rateLimitResetCredit/consume` spends one; both are stable Codex app-server methods since
0.156.0. `ProviderRuntime.#refreshUsage` keeps the count of each client with its usage reading.
`usageResets` reads the provider's own sign-in again while its process runs, and keeps the last count
while it is released; an account after the first uses the reading that the dock keeps (see
[Usage read pacing](#usage-read-pacing)). An account whose reading has no count is left out. `resetUsage` sends the consume with a new
`idempotencyKey` for each reset the user asks for, through the running client, an agent's process or a
short one in the account's folder. Then it reads the account's usage again and sends `usage-changed`.
After the answer `reset`, or `nothingToReset` (no limit of the account is spent), `AgentService` calls
`UsageLimitGate.accountReset`, which ends each limit of that account, so its held agents start again. Other providers have no credits: `resetUsage` refuses them.

Settings > Providers shows **Reset usage** in the ⋯ menu of a connected account that has a credit.
The confirmation names the credits left, and the answer shows under the accounts. A joined server
uses the optional `provider-usage-reset-v1` routes (see [Admin capabilities](servers.md#admin-capabilities)).

### Disconnect the own sign-in

Settings > Providers shows **Disconnect** in the ⋯ menu of the connected own sign-in of Claude and
Codex (issue #3487). These drivers have an `accounts.signOut` command (`claude auth logout`,
`codex logout`). `ProviderRuntime.signOutProvider` refuses while the provider runs a turn, cancels a
sign-in, and runs that command with no home variable, so it signs out the user's own home folder.
On this computer a terminal CLI shares that folder and the macOS keychain item, so it signs out too;
the confirmation says so. Then OpenBot stops the client and reports the provider signed out, as a
Gemini Reconnect does. A failed sign-out keeps the client and shows its reason. Agents keep the own
sign-in and wait for a Reconnect. The accounts after the first and their folders stay, but they
need the connected CLI, so they wait too. A joined server uses the optional `provider-sign-out-v1`
route.

## Provider settings and the ACP registry

`AgentClient` remains the provider boundary. ACP session ownership, history replay, and turn
completion stay together. Boolean and select settings can include grouped choices. The client
processes configuration notifications while idle. Model and reasoning continue to use their
existing fields. Permission, access, and approval settings remain under OpenBot controls: the agent's
Permissions level decides them, not an ACP setting.

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

## Inception

Inception is a provider of its own that runs on Pi's managed CLI. Its driver sets `cliProvider: "pi"`,
so it resolves Pi's downloaded binary and has no runtime or download of its own. After a Pi update, a
running Inception process restarts on the new binary when its turns end. Connect and Reconnect on the
row open the key dialog, and the composer's sign-in opens the Providers settings, because a key is the
only sign-in. The key is stored as the `inception` API key. `pi-key-providers.ts` writes a key-free extension that
calls `pi.registerProvider("inception", …)` with the Mercury models; the key is in the process
environment and a `globalThis` slot, because Pi runs extensions again on `switch_session`. The
Inception client lists only the `inception` models, with bare ids such as `mercury-3`. The Pi client
does not load this extension, so it keeps only the user's own `inception` models. Without a key the provider has no models and asks for a key. Team API v8 carries Inception; peers
below v8 do not see it.

## DeepSeek

DeepSeek works as Inception does: a provider of its own on Pi's managed CLI (`cliProvider: "pi"`),
with a key as its only sign-in (`KEY_ONLY_PROVIDERS` in contracts). The key is stored as the
`deepseek` API key. Pi has a built-in `deepseek` provider, so the extension from
`pi-key-providers.ts` calls `pi.registerProvider("deepseek", ...)` with the key and no models. A
registration with only the key keeps Pi's DeepSeek models, endpoint and thinking levels (checked in
Pi 1.4.0), so OpenBot keeps no DeepSeek model list. Pi prefers a `deepseek` key in its own
`auth.json` to the registered `apiKey`, so the extension also sets the `Authorization` header,
which replaces either key. A 401 or a 402 from a key provider shows a text about the saved key or
the account balance (`#failureText` in `pi-client.ts`). The DeepSeek client lists only the `deepseek`
models, with bare ids such as `deepseek-v4-pro`. The Pi client loads no key extension, so it keeps
the user's own `deepseek` models, for example from `DEEPSEEK_API_KEY` in Pi's environment.
Peers see DeepSeek from v8, as Inception.

## OpenRouter

OpenRouter works as DeepSeek does: a key-only provider on Pi's managed CLI. The key is stored as the
`openrouter` API key. Pi has a built-in `openrouter` provider with OpenRouter's model list (401 models
in Pi 1.1.0 and 1.4.0), so the extension registers only the key and the `Authorization` header, and
OpenBot keeps no OpenRouter model list. Pi sends some models to OpenRouter's Anthropic Messages
endpoint and the others to its chat completions endpoint; both read the header. On the Anthropic
Messages endpoint Pi also sends the key from its own `auth.json` as `x-api-key`, so the extension sets
that header to the OpenBot key too (checked in Pi 1.4.0 with a local server). Pi's own
`/api/models/user` request still uses a key from `auth.json` when the user saved one there; it reads
the model list and sends no turn content. Model ids keep
OpenRouter's `<lab>/<model>` form, such as `anthropic/claude-opus-5.5`, and the client passes them to
Pi unchanged. The catalog drops the aliases that start with `~`, such as
`~anthropic/claude-sonnet-latest`, because `isAgentModel` refuses that character, and the default is
`anthropic/claude-sonnet-5.5`. The model picker groups the models by lab (`openRouterLab` in
`provider-model-options.ts`) and marks the `:free` models as free. A 402 means the account has no
credits. Peers see OpenRouter from v8, as Inception.

## Muse

Muse uses the official `@muse-code/sdk` to run `muse serve` over MSP. The SDK is pinned to `1.4.2`;
newer SDK versions must meet the three-day dependency rule before adoption. The native integration
supplies `sessionMcp`, preserves native session identity, and reads durable items to recover missed
events before completion. A cached model list does not prove authentication. Connect starts the
`muse serve` device sign-in and opens its page, because `muse login` with no terminal never opens
it; an explicit Meta API key uses OpenBot's encrypted credential store. The account check asks a
short-lived `muse serve` host, which gets the same key, for the experimental `account/read`. The
session host does not opt in to experimental MSP, so its strict event decoders see no experimental
variants. A Muse CLI without `account/read` stays "not verified" and keeps running.

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

## Local context indication

The desktop uses the shared context design from PR #1786. Optional `contextStates` on the local
runtime snapshot carries numeric context use and the latest compaction state. Released Team
adapters omit this field. Remote web and mobile clients retain their current contracts.

The snapshot includes only active personal provider sessions. Reset, session replacement and
provider changes remove the old indication. A provider change publishes a runtime snapshot before
the next turn, so retired counts do not remain on screen. Execution-thread data does not enter
personal chat.

Optional `threadContextStates` carries the same state for the active provider session of each open
side thread, keyed by its `threadId`. The side thread's message box shows it. It is local only, as
`contextStates` is, and `fitRuntimeSnapshot` drops it first. A `handoff` provider cannot replace the
session of a side thread, so its `autoCompactAt` is null there.
Codex uses `tokenUsage.last.totalTokens` and its reported `modelContextWindow`. Claude reads the
SDK `getContextUsage({ detail: "summary" })` result after a turn. This uses the previous response
and local estimates; it avoids full per-category token-count requests. The read runs outside the
stream consumer, has a two-second deadline, and cannot block the next turn. Old or unsupported
reports stay absent. Claude counts carry an estimate flag, which the context ring and popover
display. The same result also gives the category rows. `claude-context-categories.ts` maps the row
names to the fixed `AGENT_CONTEXT_CATEGORIES` ids, moves tool calls and results out of the messages
row with `messageBreakdown`, and puts the rest of the total in `other`. Deferred tool rows, the
free space and the compaction buffer are not in the total, so they are left out. Only the ids and
counts leave the adapter: no row name, file path, tool or server name. Other providers give a
total only, so the popover shows no breakdown for them. Native `status` and `compact_boundary` events drive Claude's compaction notice. Claude's
`post_tokens` counts messages without the system prompt and tools, so its compaction marker omits
the token comparison. Later local estimates do not restore that comparison.

The progress percentage is an estimate based on elapsed time and the preceding compaction duration
in this process. It never proves completion. Terminal provider events control success and failure.
The latest marker and timing are runtime state, not new saved conversation messages. A provider
summary is not copied into this state.

`agent:compact-context` asks for a compaction now, below the threshold too. The popover offers it
when `autoCompactAt` is set, which means that OpenBot compacts the thread (`events`, `request` or
`handoff`). It refuses while a turn, a queued message or a session start needs the session. It is
local only: the Team API has no route, and a joined server's agent shows no ring.
`agent:tasks:compact-context` does the same for one open side thread. It refuses while the thread
has an active turn or delivery, or while its session compacts or waits after a refused start.
