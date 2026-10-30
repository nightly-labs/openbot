# Repository structure

## Workspace map

```text
apps/
  auth-api/          Public web and /app browser entry, accounts, memberships, connection tickets, and billing
  discord-app/       Developer Portal settings of the OpenBot Discord app (no code)
  mobile/            Expo React Native client for remote team hosts
  site-router/       Cloudflare Worker that serves published sites from private R2 storage
  slack-app/         Slack CLI projects with the OpenBot Slack app manifests (production, development)
  status/            Public status page on GitHub Pages, and the check and webhook scripts of its workflow
  telegram-app/      BotFather settings of the OpenBot Telegram bot (no code)
packages/
  ui/                Shared SolidJS controls and primitive styles for desktop, web, and Storybook
  brand/             Shared logos, avatars, and design tokens
  contracts/         Process and network boundary types, limits, and pure validation
  i18n/              Message catalogs, translate and format functions for desktop, shared UI and mobile
  logging/           ts-log Logger interface plus the redacting console/file implementation
  telemetry/         Safe error reports, bounded retry queue, and local storage/HTTP adapters
  team-client/       Shared team connection, recovery, WebRTC framing, Dynamic Island state, and routine schedules
  user-errors/       Shared user-facing error messages for desktop and mobile
remote/
  api/               Bun Signal service for SDP, ICE, ticket checks, TURN credentials, and the Slack, Discord, Telegram and webhook relays
  scripts/           Bun checks and update commands for Signal and coturn
src/
  backend/           Agent runtime, provider adapters, event storage, queues, and browser host
  main/              Electron lifecycle, trusted IPC, host server, and operating-system adapters
  preload/           Narrow typed bridge from Electron main to the renderer
  renderer/          SolidJS user interface
scripts/             Development, smoke, release, and package verification entry points
tools/               Biome GritQL rules, the UI foundation check, the vitest sequencer and setup, and the type baseline
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

## State ownership

- `openbot.db` is the source of truth for OpenBot agents, conversations, queues, reactions,
  attachments, and provider-session bindings.
- `RoutineStore` saves a routine and its webhook trigger in one transaction. `WebhookRouteStore`
  owns route IDs, encrypted secrets, receipts, and route revocations. `RoutineRecords` gives main one
  owner-neutral view of these. Webhook runs use the existing agent and channel queues. Main owns
  signature checks, the secret cipher, and Signal ingress (`HostEventsService`, `WebhookRelay`). D1
  stores route metadata only.
  See [Webhook routines](events.md).
- `MailboxStore` owns attachment records, staged generated attachments, mailbox commits, and the
  file-deletion outbox. `AttachmentFiles` owns draft and transfer files: copying, size limits,
  hashes, manifests, managed-path checks, and cleanup. It does not read or write the database.
  Generated response attachments become visible only after the conversation and mailbox commit
  succeeds. Agent deletion and queue edits record file removals in the mailbox transaction; the
  deletion outbox retries failed removals.
- `src/backend/provider-history.ts` defines the internal fragment reader. Provider adapters own
  pagination and decoding. `provider-history-import.ts` commits normalized message pages without
  deleting messages absent from a page. SQLite stores incomplete turns and import progress.
  ACP replay records without stable OpenBot message IDs remain provider records for handoff and
  recovery. They do not create a second copy of messages already saved by the live turn.
- `ConversationRuntime` keeps active work and a bounded recent cache. Released full-history APIs
  build their responses from SQLite for each request. They do not set the working cache.
- `~/.codex`, `~/.claude`, `~/.grok`, `~/.gemini`, `~/.cursor`, `~/.cline`, `~/.pi`, and the OpenCode
  and Muse XDG folders are provider-owned login and resume state. They are not OpenBot
  conversation storage.
- D1 is the source of truth for central accounts, remote membership, invitations, and logical sessions.
- Stripe is the source of truth for paid plans. D1 `billing_subscriptions` is a copy that the Stripe
  webhook keeps current; see [Billing](servers.md#billing).
- A local team host owns conversations, files, agents, and the local member projection used by Team API.
- `openbot-approval-automation-v3.json` holds which agents have Full access: the `autoApprove` half of
  each agent's Permissions level (Workspace only, Ask first, Full access). OpenBot reads an older
  `-v2` or `-v1` file when no v3 file exists and leaves it in place for a downgrade; Turbo mode on in
  such a file gives every agent Full access. It belongs to the computer that runs the agent and never crosses the Team API, whose released
  adapters freeze an approval response to `accept` or `decline`: a remote host that has automation
  on answers its own approvals, so they never reach a client, and a client cannot grant one on a
  remote host's behalf. `AttentionRegistry` reads it at each approval, including hosted-site
  publishing, replacement and deletion. Site validation, ownership checks and activity markers
  still apply. A grant change (`AgentService.notifyAgentsChanged`) or an access change also answers
  the approvals that already wait for an agent that now has Full access
  (`AttentionRegistry.answerGrantedRequests`). The registry also accepts, once, Codex's consent to run
  an MCP tool (`_meta.codex_approval_kind` `mcp_tool_call`, a tool set to ask every time included), and
  saves nothing: "Always allow" stays the user's choice, which Codex keeps per server and tool. A
  Workspace only agent keeps its card; a Computer Use tool does not. OpenBot keeps Codex's `approvalPolicy`
  at `on-request`, because `never` denies MCP tool calls and rejects elicitations. Other questions, MCP
  forms and sign-in requests, and browser takeovers remain interactive.
- A Workspace only agent can change files in its workspace, the shared folder, and the folders that the
  user added (`AgentSummary.additionalFolders`, in `agent_json`, real paths, at most 32). One function,
  `workspaceWritableRoots`, gives these roots to every provider sandbox, and the agent's developer
  instructions name them. Only the local `agentFolders` IPC endpoints change the list; an agent cannot
  add a folder to itself. Main refuses a disk root, the home folder, and a folder that holds OpenBot data.
  A folder that is not on the disk stays in the list but is not a root. The list is local, like
  `access`: the Team API does not carry it.
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

## Shared UI package

`@openbot/ui` owns the existing SolidJS primitives and their primitive stylesheet. Desktop,
web, and Storybook import this workspace directly. It has no dependency on the renderer,
Electron, account sessions, or host connections. Import `@openbot/ui/styles.css` after brand
tokens and include the package source in Tailwind scanning. App-specific styles remain in
the application. The desktop TypeScript project includes the package source for CI checks.

The package also owns prop-driven feature UI: the complete sidebar and its scoped interaction
stores, account login, server rail and invitation dialog, message rendering, composer
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
and `MarketplaceModal` adds the connect and uninstall dialogs. `ConnectorsProvider` creates the
connector controllers once; a connector's app page shows `ConnectorDetailPanel` from them. Server
settings has no connector section.

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
