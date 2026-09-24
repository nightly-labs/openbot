# Plan 003: MCP is robust and future-proof

## Goal

A user installs OpenBot on macOS, Linux or Windows, enables a catalog MCP
server, and it starts. No Node, no `npx` and no terminal are needed first. When
a server does not start, the user reads why.

This file replaces the first draft of plan 003, which named six stages in a
different order and left the runtime, the configuration policy and the OAuth
question open. The developer has since decided all three, and the stages below
are the ones being implemented.

## Status

| Stage | What it does | State |
|-------|--------------|-------|
| 1 | Make every failure visible | DONE |
| 2 | Ship Bun as a managed tool runtime | DONE |
| 2b | Pin `mcp-remote` in the catalog | DONE |
| 3 | Close the second configuration door | DONE |
| 4 | Native MCP OAuth, and delete `mcp-remote` | DONE |

## Decisions taken by the developer

| Decision | Choice |
|----------|--------|
| Managed JavaScript runtime | Bun, one file, no symlinks to repair |
| Bun version and cadence | 1.4.2, moved at release preparation by `bun run pin:bun-runtime` |
| x64 build variant | `baseline`, because a plain x64 Bun needs AVX2 |
| Configuration policy | The panel is authoritative. No opt-out |
| Reach | Through native OAuth, not through `mcp-remote` |
| Download moment | At onboarding, beside the provider CLIs |
| Snapshot shape | `toolRuntimes`, a second field, not a wider `providers` |

Bun was chosen over Node against the recommendation. The reason for the
recommendation stands and is mitigated, not argued again: a server that reaches
for a Node internal fails one server at a time after release, so Stage 2 appends
the managed `bin` directory **last** on `PATH` and Stage 1 shipped first.

## What is already correct

Do not change these. They are the reason this plan is small.

- One store, one normalization step (`usableMcpServers`), one adapter per
  provider shape (`src/backend/mcp-provider-shapes.ts`).
- The reserved-name guard, and OpenBot's own bridge servers spread last.
- The grow-only hand-off log for redaction (`src/backend/mcp-handoff-log.ts`).
- The Codex tool fingerprint that forces a replacement session
  (`src/backend/agent/thread-lifecycle.ts`).

## Hard constraints

- **No stored health state.** A failure is an event at hand-off, never a column.
  A stored result is a claim about right now that nothing keeps true.
- **`mcp-v1` is frozen.** Showing a remote administrator a hand-off failure needs
  a second capability string and is out of scope.
- **No migration.** No stage here adds one.
- **PolyForm Noncommercial stays.** Bun is MIT, and its licence is staged and
  checksummed with the binary.

## Stage 1 - Make every failure visible (DONE)

`McpServerDrop` gives a dropped server a shape, the three adapters return
`McpHandoff<T>` instead of a silent `continue`, and `reportMcpDrops` carries the
drops to `AgentService`, which writes one log line and one `mcp_server_not_started`
event per new cause. The event carries no `agentId`, so the renderer raises one
deduplicated toast rather than a banner in every conversation.

The panel copy that denied Codex HTTP servers is corrected, and
`mcpProviderLimitNote` states the working-directory limit from the saved row
alone. `resolveMcpCommand` is memoized on `PATH\0command`, and the Test button
clears that cache, because Test is the user asking about now.

Not done: the Windows `where.exe` measurement. It needs a Windows machine, and
the fix must not be written from reasoning alone.

## Stage 2 - Ship Bun as a managed tool runtime (DONE)

`ManagedToolRuntimeId` is a separate identifier space, so `providers` still means
"a provider CLI" and every renderer reader of that total record is unchanged.
`ProviderRuntimeSnapshot.toolRuntimes` carries the new statuses.

Two deviations from the plan as approved, both deliberate:

- **No `npx` shim script.** Bun dispatches on the name it is called by, so the
  descriptor hard-links `bunx` beside `bun`; a copy named `npx` would answer as
  `bun`. `npx` is instead an alias consulted only after the full `PATH` lookup
  fails, which keeps the user's own `npx` ahead of the managed one.
- **The download is reported in the MCP panel**, not in onboarding. It is shown
  only while downloading or after a failed download, only for the local server,
  and it gates nothing: a failed download must not reach onboarding, because MCP
  is optional.

`bun run pin:bun-runtime [version]` recomputes the lock block from the npm
registry and asserts `bun --version` on a matching host.
[docs/RELEASING.md](../docs/RELEASING.md) holds the procedure, and the
release-upgrade-safety skill asks about the pin at Step 2b.

## Stage 2b - Pin `mcp-remote` (DONE, then superseded by Stage 4)

The six bridge listings named `mcp-remote@0.14.2`, and `build-plugin-catalog.ts`
rejected anything that was not `mcp-remote@<version>`. Shipping a runtime is what
turns `@latest` from a mostly dead path into a live unreviewed download, so this
had to land with Stage 2 and not after it. Stage 4 then removed the bridge, and
with it the rule; the pin never reached a release on its own.

## Stage 3 - Close the second configuration door (DONE)

Claude is started with `strictMcpConfig: true`, which takes away project
`.mcp.json`, user settings, plugin and agent-frontmatter MCP servers and nothing
else. `settingSources` is unchanged, so permissions and hooks still load.

Codex is started with every name from its own `config.toml` set to
`{ enabled: false }`, with OpenBot's entries spread on top. The swept names are
folded into the tool manifest fingerprint and `CODEX_MCP_ADAPTER_VERSION` is `3`,
because Codex ignores MCP configuration on resume: without both, a user who edits
that file keeps the old tools while the panel says otherwise.

OpenCode and Grok document no equivalent flag. Guessing a key name would fail
silently at the next turn, which is the failure this plan exists to remove, so
the limit is stated in the panel instead.

The upgrade is user-visible and has no opt-out: a server declared outside OpenBot
stops reaching agents. `CHANGELOG.md` says so.

## Stage 4 - Native MCP OAuth, and delete `mcp-remote` (DONE)

The motive was the redaction rule, not convenience: `mcp-remote` held six OAuth
refresh tokens outside `safeStorage`, outside `src/backend/mcp-redaction.ts` and
outside `McpHandoffLog`. A token OpenBot cannot see is a token it cannot redact.

OpenBot writes no crypto and no discovery. `@modelcontextprotocol/sdk@1.30.0`
supplies metadata discovery, RFC 7591 registration, PKCE authorization, the code
exchange, refresh and the `auth()` driver. What this stage added:

- `src/backend/mcp-oauth-provider.ts` - `McpOAuth`, the authority, and the
  `OAuthClientProvider` it builds per server. A sign-in is keyed by a `state`
  this run generated, so a grant the run did not ask for finds nothing.
- `src/main/mcp-oauth-store.ts` - the encrypted file, a copy of
  `provider-credential-store.ts` with the cipher passed in as two callbacks.
- `src/main/deep-link-router.ts` - the `mcp-auth` variant, classified with the
  other two and then never sent to a renderer: a grant is a secret.
- `mcp-provider-shapes.ts` - `McpAuthorizationSource` threaded through
  `usableMcpServers`, and `mcpHandoffHeaders`, which adds `Authorization` at
  hand-off and never to the stored row. A header the user typed still wins.
- `mcp-probe.ts` - `authProvider` on the transport, and the 401-then-sign-in
  retry. Only a test the user pressed is interactive; a thread start is silent.
- The six listings are `transport: "http"`, and the `mcp-remote` rule is gone.

**Probe result.** All six answer `401` with an RFC 9728 `resource_metadata`
pointer, advertise an RFC 7591 `registration_endpoint`, and support PKCE `S256`,
so all six moved rather than four. Linear was the one correction the STOP below
asked for: `https://mcp.linear.app/sse` is `404`, and the live address is
`https://mcp.linear.app/mcp`.

**Known limit, accepted.** All three adapters copy headers once, at spawn. When
an access token expires mid-thread the tools go away. A bounded session with a
token OpenBot can redact beats an unbounded one it cannot, and this is the
measurement that decides the bridge below.

## Deliberately not now

- **Per-agent MCP scope.** It needs no migration and no wire change:
  `projection_agents.agent_json` is a blob, and both v1 and v4 project agents
  through an explicit key list. With Stages 1 to 3 landed the complaint is "my
  server does not start", not "my agent has too many", and before the bridge this
  filter is written three times and then deleted.
- **A declarative per-provider capability table.** No, and not later. Each adapter
  is about thirty lines, and each drop carries a paragraph of measured evidence. A
  boolean table hides those facts and makes the next provider's unknowns look like
  known `false` values.
- **Routing user servers through `src/backend/local-mcp-bridge.ts`.** The right
  end state: one adapter, `workingDirectory` everywhere, one shared process, OAuth
  with a single home that can refresh, and per-agent filtering as a routing rule.
  The understated cost is that OpenBot inherits process supervision, restart and
  crash reporting for arbitrary third-party binaries. Triggers, any one of which
  reverses this: Stage 4 ships and a token expires inside a live thread; a fifth
  provider shape appears; per-agent filtering is wanted for a real user reason.
- **Reporting hand-off failures to a remote Team API administrator.** Needs a
  second capability string, and `mcp-v1` is frozen.

## Verification

Per stage: `bun run test:desktop -- <the file the stage names>`, then
`bun run lint` and `bun run typecheck`, with `bun run check:ui` for Stages 1 and 3.
Ask before anything wider.

By hand, on a machine with no Node, after Stage 2:

1. `bun run dev --isolated`, complete onboarding, and confirm that cancelling the
   Bun download still finishes onboarding.
2. Enable a real npm-package catalog server - Brave Search or Airtable, not one of
   the six bridge entries - press Test, and confirm it connects.
3. Start a thread on Claude and again on Codex, and confirm the tools appear.
4. Set a working directory on a stdio server. Claude still gets it; Codex and
   OpenCode raise exactly one toast naming the server and the reason, and a second
   turn adds no second toast.
5. Rename the command to one that does not exist, and confirm the Test button and
   the toast give the same sentence.
6. Install Node, restart, and confirm the user's own `npx` wins over the managed
   runtime. That is the Bun mitigation, and it is worth checking by hand.

After Stage 3: a server declared only in `~/.claude/settings.json` no longer
reaches an agent, and a Codex thread started before the upgrade is replaced once
rather than resumed with stale tools.

## STOP conditions

- The Windows `where.exe` fix of Stage 1 waits for a measurement on Windows.
- Stage 4's transport probe is done; all six speak Streamable HTTP.
