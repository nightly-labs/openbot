# Plan 010: Branch a conversation from a message (design draft)

> **State**: IN PROGRESS. The developer approved prototype B on 2026-10-30. Native Claude and Codex forks are deferred.
> **Planned at**: commit `57904662c` (`origin/main`, 2026-10-30).

## Request

User feedback: "Branching is a must-have for me, required for development. Hermes has it."
Developer decision: "Branch from here" on a message makes a new chat of the same agent with the
history up to that message.

## Summary

A branch is a **side thread** (`projection_agent_threads`, "task" in code and on the wire) of the
same agent. Side threads already have their own conversation, provider session, queue, tab, rename,
archive and delete, on desktop, web and mobile. A branch adds three things to a side thread:

1. A copy of the source conversation up to the branch point.
2. A link to the source thread and message.
3. A provider session that starts with that history: a native fork where the provider can fork at
   that point, else a new session with a transcript handoff.

The agent keeps its identity, workspace, memories and provider settings. Nothing is reset.

## What exists today

| Feature | Where | Why it is not a branch |
|---|---|---|
| Duplicate agent | `src/backend/agent/duplication-gate.ts:249` | Makes a new agent; "the copy carries no conversation". |
| Side question | `packages/contracts/src/ipc-agent-side-question.ts` | Not persisted as a thread. |
| Side threads | `docs/architecture/agents.md` "Agent threads"; `AgentTasks.create` (`src/backend/agent-tasks.ts:150`) | Start empty. **This is the base for a branch.** |
| "Run in new thread" | `AgentService.runQueuedMessageAsTask` (`agent-service.ts:4279`), tab `open()` in `agent-thread-tabs.ts:389` | Closest UI flow: makes a thread and opens its tab with focus. |
| Transcript handoff | `src/backend/agent/handoff-history.ts`, `ThreadLifecycle.buildProviderHandoff` (`thread-lifecycle.ts:1496`) | Seeds a new session of the **same** thread. Returns `null` for a thread with no sessions (`:1503`), and has no "up to message X" cut. |

No code copies messages between threads (searched `src/backend`; migration 47 moves task rows only).

## 1. Data model

### Branch point

The cut is a **whole turn**: the turn of the chosen agent message, through its last row.

- Native forks work per turn: Codex `lastTurnId` is "inclusive"; Claude must fork at "the KEPT
  turn's last chain entry" (`claude-agent-sdk/sdk.d.ts:2138-2186`).
- A turn has more rows than one message (commentary, plan, `final_answer`, attachments), and
  messages queued during a turn sort after its answer (`thread-message-order.ts:4-21`).
- So the branch keeps every row whose order key (`ORDER_KEY_COLUMNS`,
  `conversation-queries.ts:652`) is less than or equal to the **last row of that turn's group**. User
  messages queued during the turn stay out.
- As in Hermes, the action shows **once per turn**: on the last agent message of each finished turn.
  Hermes shows its branch button only on "the group's last text-bearing row"
  (`apps/desktop/src/components/assistant-ui/thread/assistant-message.tsx:337-352`), and keeps the tool
  results after an assistant boundary (`hermes_state_mutation_branch.py`, `_branch_boundary`). So the
  user never picks a point inside a turn.
- As in Hermes, the source thread must be **idle**. Hermes refuses with "Stop the current turn before
  branching this chat." (`require_idle` on source and target). In OpenBot the item is disabled while
  the source thread has a running turn. Codex refuses a fork of a turn in progress, and an idle source
  gives Claude a stable session file to fork.

### Rows

New side thread, created by `AgentThreadStore.create` with `origin = 'user'`. Three new nullable
columns on `projection_agent_threads`:

| Column | Meaning |
|---|---|
| `branch_source_thread_id` | The source thread (main chat `projection_agents.thread_id`, or a side thread). No foreign key: the source can be deleted, and the branch stays. |
| `branch_source_message_id` | The message the user chose, in the source thread. |
| `branch_through_message_id` | The last copied row in the branch. The UI shows the branch marker after it. |

All three are null for a thread that is not a branch, or all three are set.

Copied rows:

- `projection_thread_messages`: one copy of each kept row with a **new message id**, the same
  `turn_id`, `author`, `item_type`, `created_at`, `ordinal`, order keys and `message_json` (with its
  `id` changed). New ids are necessary because `projection_reactions` is keyed by
  `(agent_id, message_id, …)` (`openbot-database-schema.ts:268-277`): the same id would share
  reactions between source and branch. Reactions are not copied.
- `projection_turns` is not copied: `turn_id` is a global primary key (`:195`). Copied rows keep the
  `turn_id` text for grouping only. **Check during implementation**: every reader that joins messages
  to turns must accept a missing turn row (`readHandoffHistory` reads `providerSessionId` through it).
- One conversation event (`snapshot` of the copied rows) is dispatched with the thread-create event,
  in one transaction. Replay throws on a thread with no conversation event (`thread-replay.ts:166`).
  The write goes through `persistConversationChanges` (`conversation-writer.ts:451`), the side-thread
  writer.
- The copy must not add `agent_usage_activity` rows or usage analytics. **Not confirmed** where those
  rows are written; check that the conversation writer does not add them.
- Read state: the branch is read through `branch_through_message_id` for the member who made it.
- Title, as Hermes `lineage_title_on_conn` ("my session" → "my session #2"), `title_source = 'auto'`:
  - Source is a side thread: "{source title} #N", with the next free N among the branches of the same
    root.
  - Source is the main chat: the main chat has no stored title (its tab label is an i18n text), so the
    title is `taskTitle` of the last user message in the copied history.
  - Rename stays available.
- Idempotency: the request carries a client request id, as Hermes `idempotency_key`. A double click or
  a retried Team API request returns the same branch.
- Limit: the branch counts toward the 50 open side threads (`INPUT_LIMITS.agentTasks`). At the limit,
  the action fails with the existing limit error.

### Attachments

Attachment cards in `message_json` hold attachment ids. `MailboxStore.resolveAttachment`
(`mailbox-store.ts:2395`) finds an id in mailbox messages, then in generated records, across all
threads. So a copy that keeps the ids works while the source records exist.

The risk: deleting a **side-thread** source runs `deleteTaskMessages` (`mailbox-store.ts:904-971`),
which removes its mailbox messages and the files that no other mailbox record uses. The branch then
shows "file gone". Main-chat files and generated files survive a thread delete.

Decision: copy the files at branch time. Hermes makes the branch "an independent copy"
(`_clone_message_rows`), and so does OpenBot.

- Clone each file of the kept rows with `fs.copyFile(src, dst, COPYFILE_FICLONE)`: no disk cost on
  APFS; a full copy on ext4 and NTFS.
- Store the copies as generated attachment records of the branch thread, with new ids, and rewrite
  the ids in the copied `message_json`. Generated records already outlive a thread delete and go with
  the agent (`mailbox-store.ts:1606, 1680`).
- The branch is then a fully independent copy, as in Hermes.

Alternative: keep the ids and make `deleteTaskMessages` keep a file that a `thread-message` row of
another thread still names. No disk cost, but it changes a delete path and a record lookup.

## 2. Provider session

The branch uses the agent's **current** provider, model and account. The first message the user
sends in the branch starts its session.

Hermes runs its own model loop, so it copies the parent's exact system prompt and wire content and
"the branch's first turn replay[s] the parent's exact wire bytes (warm cache)". OpenBot runs provider
CLIs, so the same result comes from a native provider fork: the provider keeps its full context
(reasoning, tool results, images) and its prompt cache. The handoff is the fallback, as Hermes
`session.create` with plain messages is its fallback for an old backend.

Hermes resets file-edit approval to "ask" in a branch. OpenBot does not: permissions are one agent
setting (#2337), and a branch keeps the agent as it is.

| Provider | Fork at a point | v1 strategy | Evidence |
|---|---|---|---|
| Claude | Yes, any chain entry | **Native**: `forkSession(sourceSessionId, { upToMessageId })`, or `resume` + `forkSession: true` + `resumeSessionAt`. Fork at the last chain entry of the kept turn, found with `getSessionMessages` (OpenBot sends the turn id as the prompt uuid, `claude-client.ts:1034`). | `sdk.d.ts:847-879, 2124-2186` in SDK 0.3.309 (node_modules). **Not confirmed** for CLI 2.1.263 in `native-runtime.lock.json`. |
| Codex | Yes, through a turn | **Native**: `thread/fork { threadId, lastTurnId }`. Stored `turn_id` values are Codex turn ids (`turn-lifecycle.ts:540-566`). | `ThreadForkParams.lastTurnId` "Optional last turn id to fork through, inclusive" in the schema from `codex app-server generate-json-schema`, Codex 0.166.0. **Not confirmed** for the locked 0.160.1 (no binary on disk; strings of 0.153.4 have it). |
| Pi, Inception, DeepSeek, OpenRouter | Yes, before a user entry (`fork`), or whole branch (`clone`) | Handoff in v1; native later. | Pi `docs/rpc-commands.md:610-680` in installed 1.4.0. **Not confirmed** for locked 1.1.0. |
| Grok | Maybe (`x.ai/session/fork`, `targetPromptIndex`) | Handoff. | Undocumented extension in installed 1.0.70. **Not confirmed**. |
| OpenCode, Cursor, Cline, Antigravity, custom ACP | Whole session only (`unstable_forkSession`, no message id) | Handoff. | `@agentclientprotocol/sdk` 1.9.0 `acp.d.ts:1055`, `types.gen.d.ts:4780`. |
| Muse | No | Handoff. | `muse-protocol.ts`: start, resume, read, compact only. |

**Handoff** (all other cases): a new session seeded with the copied history, through the existing
path: `renderProviderHandoff` (32,000 characters), stored as a pending handoff and put in front of
the first message (`drain-scheduler.ts:785-793`). Two changes:

- `buildProviderHandoff` must also return a handoff for a branch thread with no sessions yet.
- Work-step captures come from the source sessions of the copied turns.

Because the rows are copied, `history_search` and `history_read` in the branch find the full copied
history (`history-tools.ts:46-52` reads the thread's own rows).

**Fallback rules**: a native fork is an optimization. The branch always succeeds with a handoff when:

- the source turn ran on another provider (the agent changed provider),
- the source session is gone or `failed`,
- Claude refuses with `Resume rejected by --resume-drops-turn:` (the SDK says: do not retry),
- Codex rejects the fork, or the fork has a stale tool fingerprint (`thread-lifecycle.ts:409-427`
  replaces such a session; with a handoff it keeps the history).

When the fork happens: at branch time (eager) for Claude `forkSession`, which is a file copy, and on
the first turn (lazy) for Codex, which needs the app-server running.

**Workspace files are not rolled back.** OpenBot has no checkpoint or rewind (no
`enableFileCheckpointing`, `rewindFiles` or `thread/revert` call in `src/`). The branch works on the
files as they are now. The first message of the branch tells the provider so, in the handoff header
or as a short developer note for a native fork. Rewind is a separate feature.

## 3. SQLite migration 48

Rules: `src/backend/AGENTS.md`. Latest version today: 47 (`openbot-database-schema.ts:869-875`).

- Migration 48: three `ALTER TABLE projection_agent_threads ADD COLUMN … TEXT` statements. No table
  rebuild, no foreign-key pause, no data change: every existing row gets null.
- The "all null or all set" rule lives in the store, not in a CHECK: an `ADD COLUMN` CHECK cannot be
  a table constraint, and a rebuild only for it is not worth the risk.
- `AGENT_THREAD_SCHEMA_SQL` (the latest schema for new databases) gets the same three columns **at
  the end of the column list**, so that the parity test sees the same `sqlite_master` SQL as an
  upgraded database.
- Add `"48"` to `openbot-database-schema-history.json` (the parity test prints the entry).
- Schema marker and DDL in one transaction, as the framework does.
- Vitest (permitted: migration area), in the shape of `src/backend/agent-thread-migration.test.ts`:
  data-preservation fixtures for every released schema 8 to 47, late-failure rollback and retry,
  newer and incomplete histories, downgrade, foreign keys and integrity check.
- An older app that opens a version-48 database: covered by the existing "newer history" refusal.
  **Check** that the downgrade fixture asserts it.

No other table changes. Copied messages, events and generated attachment records use existing tables.

## 4. Contracts and surfaces

### IPC (desktop)

- `packages/contracts/src/ipc-agent-tasks.ts`: `BranchAgentTaskInput { agentId; taskId: string | null;
  messageId }` (`taskId` null = main chat). Result: `AgentTask`.
- `AgentTask` gets an optional `branch: { sourceTaskId: string | null; sourceMessageId; throughMessageId } | null`.
  The Team API `agent-tasks-v1` codecs are exact-key, so the host must not send this field there.
- `ipc-endpoints.ts`: `branchTask: scopedRequest<BranchAgentTaskInput, AgentTask>()("agent:tasks:branch")`
  in the `agent` group.
- Main: `scopedHandler(parseBranchAgentTaskInput, { local, remote })` in `agent-handlers.ts`, parser in
  `agent-inputs.ts`; `remote` uses the new Team API capability, or fails with
  `error.backend.branchRemoteUnsupported`.
- Preload: `decodeAgentTask` for the result.
- Backend: `AgentService.branchTask` as a named `Effect.fn`, typed errors (`Schema.TaggedError`):
  source not found, turn running, limit reached. Public error codes map to `@openbot/i18n` keys.
- Preview mock `src/renderer/src/preview/mock-openbot.ts`: a real branch: copy the mock messages up to
  the point, add the task, emit `agent-tasks-changed`.

### Team API (joined desktop, web, mobile)

Released protocols are frozen (`packages/contracts/AGENTS.md`). New optional capability
`agent-thread-branch-v1` (`packages/contracts/src/team-protocol/agent-thread-branch-v1.ts`):

- `POST /v1/agent-threads/branch` `{ agentId, taskId | null, messageId }` → the frozen `agent-tasks-v1`
  task plus `{ sourceTaskId, sourceMessageId, throughMessageId }`.
- `POST /v1/agent-threads/branches` `{ agentId }` → the branch link of each side thread that has one,
  so clients can show the marker.
- `chat` agent level; a hidden agent answers 404; no capability answers 400.
- Add it to `TEAM_CURRENT_CAPABILITIES` and `TEAM_PROTOCOL_V9_ONLY_CAPABILITIES` (protocols 7 and 8
  have full 128-entry lists), with frozen fixtures.
- Host route in `src/main/team-api/route-agent-threads.ts`; team client call in
  `packages/team-client/src/team-api-requests.ts`.

### Surfaces

| Surface | v1 | How |
|---|---|---|
| Desktop renderer, local server | Yes | Menu item, IPC, tab opens with focus. |
| Desktop renderer, joined server | Yes, when the host has the capability | Same, over Team API. |
| Web client (`apps/auth-api` loads `@openbot/renderer-web`) | Yes, when the host has the capability | `webAgentTasksPort` gets an optional `branchTask`. |
| Mobile (`apps/mobile`) | **Later** | An optional Branch button in `ChatMessageActions` (`chat-message-actions.tsx:63-256`), then `router.push("/task/[taskId]")`. Hermes puts it in the "More actions" menu on touch. |
| Hosted site router, Signal | No change | — |
| Docs | Yes | `docs/architecture/agents.md` "Agent threads", `docs/glossary.md` ("branch": a side thread with copied history; not a git branch). `PRIVACY.md`: no change, no new outbound data. |

Reverse action: delete the branch thread (existing delete with Undo). The source never changes.

## 5. UI entry point

Hermes desktop: a `GitFork` icon button "Branch in new chat" in the hover action bar of the last text
message of each turn, and the same item in "More actions" on touch
(`assistant-message.tsx:1373-1446`). The sidebar row menu has "Branch from here" for the whole chat
(`sidebar/session-actions-menu.tsx:429`). OpenBot keeps the developer's entry point, the message
menu, and takes the rest from Hermes:

- `MessageMenu` (`packages/ui/src/features/conversation/MessageRendering.tsx:886-978`): a new optional
  prop `onBranch`, item "Branch from here" (`chat.menu.branch`, all locales), Lucide `GitFork` icon (as
  Hermes), after the separator before Mark unread.
- `ConversationTimeline.tsx`: a named `branchAction(message)`, as `markUnreadAction` (`:211-215`). It
  gives the item only to **the last agent message of a finished turn**, in an agent chat (not a
  channel). While the thread has a running turn, the item shows disabled.
- Side threads: `AgentThreadView` (`threads/AgentThreadView.tsx:290-302`) gets the same message menu,
  so a branch can be branched again (Hermes nests "a branch-of-a-branch ... under its own parent").
- After a branch: the branch opens as a tab and takes focus, as in Hermes when the source is the open
  chat (`use-session-actions/index.ts:2771-2787`). `agent-thread-tabs.ts` calls `open()` and adds the
  id to `seen`, as "Run in new thread" does (`:389-394`). The composer is empty and no turn starts.
- Thread menu (the list of all threads in the chat header): a branch shows under its source, with the
  Hermes tree stems `├─` and `└─` (`apps/desktop/src/lib/session-branch-tree.ts:176-183`). A branch whose
  source is gone shows at the top level. The tabs stay flat.
- In the branch: a divider after `branch_through_message_id`: "Branched from {source title}". A click
  opens the source thread at the source message (reuse the jump of #2383, "Open the original message
  from the quote"). If the source is gone: "Branched from a deleted thread", no link. Hermes has no
  divider; OpenBot needs one because the copied history and the new messages are in one view.
- Analytics: `agent_action` gets `action: "branch"` with `result` and
  `session: "fork" | "handoff"`. No content.
- Storybook: `src/renderer/stories/MessageMenu.stories.tsx` (`MenuRow` passes `onBranch` for the last
  agent row of a turn) and `AgentThreads.stories.tsx` (the new tab, the divider and the nested thread
  menu).

## 6. Hermes Agent, for reference

Source: `NousResearch/hermes-agent` at `6bb377a` (2026-10-30), clone in `/tmp/hermes-research/src`.

| Topic | Hermes | OpenBot design |
|---|---|---|
| Entry | `/branch [--here] [name]`, alias `/fork` (`hermes_cli/commands.py:108`); desktop "Branch in new chat" per turn; sidebar "Branch from here" | Message menu "Branch from here", once per turn |
| Storage | New `sessions` row, `parent_session_id`, `model_config._branched_from`; rows copied with `_clone_message_rows` through `through_message_id` (`hermes_state_mutation_branch.py`) | New side thread, `branch_source_*` columns, rows copied with new ids |
| Cut | Assistant boundary keeps the tool results after it | Whole turn |
| Busy source | Refused: "Stop the current turn before branching this chat." | Item disabled |
| Title | Given name, else "{parent} #N" | Same for a side-thread source; last user message for the main chat |
| Model and context | Parent's frozen policy, exact system prompt and wire bytes (warm cache) | Native provider fork, else handoff |
| Permissions | File-edit approval resets to "ask" | Unchanged (agent setting) |
| MCP | Connections prepared again for the child | Each side thread already starts its own provider session |
| Request | `idempotency_key` | Client request id |
| After branch | Opens as a tab; takes focus when the source is the open chat | Same |
| Lineage view | Sidebar nests branches with `├─` / `└─` | Thread menu nests branches |
| Files | Not rolled back; `/rollback` with opt-in checkpoints is separate | Not rolled back; rewind is separate |

Others: ChatGPT "Branch in new chat" (copy up to the message; third-party sources only); Claude Code
`/branch`, `--fork-session`, and the `Esc Esc` rewind; Codex `/fork`, `codex fork`, and `Esc Esc` to
edit a previous message and fork from it.

## Decisions

Developer direction on 2026-10-30: "take inspiration from" Hermes. Applied:

1. Branch point: the whole turn; the item is on the last agent message of each finished turn.
2. Branch from a side thread: yes, `AgentThreadView` gets the message menu.
3. Attachments: copied at branch time.
4. Provider: Claude and Codex fork natively; all others get the handoff.
5. Mobile: a second change.
6. Title: "{source title} #N", or the last user message for a main-chat source.
7. Branch from a user message (edit and fork): out of scope. Hermes has it only as `/undo`, in place.

Open:

- Whole-thread branch from the thread menu (Hermes sidebar "Branch from here"): add in v1, or later?

## Verification (for the implementation)

- Migration Vitest as in section 3.
- E2E `scripts/agent-threads-branch-e2e.ts`, modelled on `scripts/agent-threads-e2e.ts`: branch from
  the main chat and from a side thread, check copied rows and attachments, delete the source and open
  the branch attachment, send a message and check the provider got the history. JSON report in
  `.openbot-build/`.
- Narrow checks only: `bun run test:changed`, `bun run typecheck:node`, `bun run typecheck:renderer`,
  one at a time.

## Rejected alternatives

- **New agent with the copied history** (as Duplicate): rejected. A branch keeps the agent identity and
  workspace.
- **Reference the source rows** (no copy): rejected. The branch must outlive the source, and the
  history tools and handoff read the thread's own rows.
- **A new `origin = 'branch'`**: rejected. The `origin` CHECK needs a table rebuild, and the released
  `agent-tasks-v1` decoders accept only `user` and `agent`.
- **A stored "branched" message** in the conversation: rejected. Released clients do not know the item
  type; the divider is drawn from the thread row instead.
