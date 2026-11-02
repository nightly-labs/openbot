# Plan 007: The web client keeps only the latest page of a conversation that is not open

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you start the
> next step. If a "STOP conditions" item occurs, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ac4880d86..HEAD -- src/renderer/src/features/web-client/web-client-context.tsx src/renderer/src/preview/bench-web-runtime.ts src/renderer/src/features/conversation/conversation-context.tsx`
> If one of these files changed, compare the "Current state" excerpts with the
> live code. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ac4880d86`, 2026-10-17

## Why this matters

The web client (`/app`, also used on phones through the browser) keeps a
`conversations` record with one entry for each agent the user opened. Each entry
holds every message page that the user loaded, and live deltas keep adding to
it. Nothing removes old pages when the user opens another agent. A user who reads
back through a long history in several agents keeps all of it in memory for the
whole session. Each delta also writes into a larger store.

The desktop renderer solved the same problem: `trimToLatestPage` keeps only the
latest page of an agent that is not open. This plan gives the web client the same
rule, adapted to its cursor pagination.

## Current state

- `src/renderer/src/features/web-client/web-client-context.tsx` (1702 lines) — the
  web workspace store.
  - Lines 61-69:
    ```ts
    interface WebConversation {
      page: ConversationPage | null;
      /** The originals that a host page says are deleted, by id. */
      missingReferences?: Record<string, true>;
      draft: string;
      attachments: AttachmentSummary[];
      loading: boolean;
      error?: string | null;
    }
    ```
  - Lines 1159-1180, `select(id)`: sets `draft.selectedId = id`, does
    `draft.conversations[id] ??= { page: null, draft: "", attachments: [], loading: true }`,
    then `await load(id)`. It does nothing to the conversation that was open before.
  - Lines 1016-1060, `load(id, older = false)`: reads `runtime.conversation(id, before)`
    and merges:
    ```ts
    item.page = {
      ...page,
      messages: mergeConversationPage(old?.messages ?? [], page.messages, older ? "older" : old ? "latest" : "replace"),
      references: { ...old?.references, ...page.references },
      pageInfo: !older && old ? old.pageInfo : page.pageInfo,
      revision: older && old ? old.revision : page.revision,
    };
    ```
    Note `pageInfo: !older && old ? old.pageInfo : page.pageInfo`: a latest read
    keeps the old `olderCursor`. `load(id, true)` returns early when
    `pageInfo.olderCursor` is null (line 1019-1020).
  - Lines 1093-1110: a conversation delta appends to `draft.conversations[event.agentId].page`
    for any agent that has a page, open or not.
  - Lines 1577-1592, `openSearchMessage`: loads older pages until a message is
    present. The web client has no "around" window: a page is always the newest
    messages plus contiguous older pages.
  - Entries are deleted only when an agent is removed or the host is reset (lines
    592, 637, 750, 856).
- `src/renderer/src/features/conversation/conversation-context.tsx:54-77` — the desktop
  rule to copy:
  ```ts
  const LATEST_PAGE_SIZE = 50;
  function trimToLatestPage(conversation: ConversationState): void {
    if (conversation.messages.length <= LATEST_PAGE_SIZE) return;
    const kept = conversation.messages.slice(-LATEST_PAGE_SIZE);
    const removedById = new Map(conversation.messages.slice(0, -LATEST_PAGE_SIZE).map((message) => [message.id, message]));
    // A kept reply keeps the quote of an original that the trim removes, as a page from the host gives it.
    const references: Record<string, AgentMessage> = {};
    for (const message of kept) {
      const originalId = message.replyToMessageId;
      const original = originalId ? (removedById.get(originalId) ?? conversation.references?.[originalId]) : undefined;
      if (originalId && original) references[originalId] = original;
    }
    conversation.messages = kept;
    conversation.references = references;
    conversation.page = { hasOlder: true, olderCursor: null };
  }
  ```
  The desktop can set `olderCursor: null` because it reloads differently. The web
  client cannot: a null cursor stops `load(id, true)`. That is why Step 2 uses a
  `trimmed` flag.
- `src/renderer/src/features/conversation/conversation-merge.ts:32-41` —
  `mergeConversationPage` removes from `loaded` every id that is on the new page,
  so an overlap between pages is safe.
- `src/renderer/src/preview/bench-web-runtime.ts` (173 lines) — the mock host of the
  Storybook story `Web/Workspace/LongConversation` (`src/renderer/stories/WebWorkspace.stories.tsx:46`).
  It seeds 160 messages (`SEEDED_MESSAGES`) into the first agent, user messages
  read `Question <index>: ...`, counts host calls in `calls`, and installs
  `globalThis.openbotWebBench` with `ready`, `calls`, `resetCalls`, `idle` and `stream`.
- `scripts/web-client-perf-e2e.ts` — `bun run perf:web`. Its runtime phase
  (lines 349-436) opens the story at
  `${storybook}/iframe.html?id=web-workspace--long-conversation&viewMode=story`
  with `playwright-core`, waits for `globalThis.openbotWebBench`, and reads calls.
  Copy its browser setup for the new script.
- Store rules (`src/renderer/AGENTS.md`): stores hold plain values; never put a
  `Map` or `Set` in a store.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (fresh worktree only) | `bun install --frozen-lockfile` | exit 0 |
| Storybook (leave running) | `bun run storybook` | prints the local URL |
| New E2E | `bun scripts/web-client-conversation-trim-e2e.ts --storybook=<url>` | exit 0, report `"passed": true` |
| Related tests | `bun run test:related -- src/renderer/src/features/web-client/web-client-context.tsx` | exit 0 |
| Typecheck | `bun run typecheck:renderer` | exit 0 |
| Lint changed files | `biome check --write --max-diagnostics=none <changed paths>` | exit 0 |

Do not run `bun run typecheck`, `check:ui` in full, builds or full suites.

## Scope

**In scope**:
- `src/renderer/src/features/web-client/web-client-context.tsx`
- `src/renderer/src/preview/bench-web-runtime.ts` (count older-page reads, expose agent names)
- `scripts/web-client-conversation-trim-e2e.ts` (create)
- `changelog.d/<branch>.md` (create)

**Out of scope**:
- The desktop `conversation-context.tsx`. Do not move `trimToLatestPage` into a
  shared module in this plan; the two state shapes differ.
- `packages/ui` and the conversation view components. No visual change.
- `scripts/web-client-perf-e2e.ts`. Do not change what `perf:web` measures.
- The host page size. Use 50, the same as the desktop.

## Git workflow

- Branch: `advisor/007-web-trim-conversations`.
- Commit message: one imperative sentence, for example `Keep only the latest page of web conversations that are not open`.
  End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs checks. Never use `--no-verify`. Do not push or open a PR unless told to.

## Steps

### Step 1: Make the bench show older-page reads, and write the E2E

1. In `bench-web-runtime.ts`, wrap `conversation` so it also counts
   `calls.conversationOlder` when the second argument (`before`) is defined.
   Add `agentNames: { open: string; other: string }` to the bench object, filled
   in `seed()` from the two agents of `listAgents()`. Add the new field to the
   `WebBench` type in the same file.
2. Create `scripts/web-client-conversation-trim-e2e.ts`. Header comment: what it
   proves, and `bun scripts/web-client-conversation-trim-e2e.ts --storybook=<url>`.
   Copy the Chromium launch and the story open from `web-client-perf-e2e.ts`.
   Steps of the script:
   - Open the story; wait for `openbotWebBench.ready` and for the text `Question 158:`.
   - Scroll the conversation to the top until `Question 0:` is visible (use
     `page.mouse.wheel(0, -4000)` in a loop with `openbotWebBench.idle()` between,
     and a limit of 40 rounds). Record `conversationOlder` (expect 3 or more).
   - Click the other agent by `agentNames.other` in the sidebar, `idle()`, then
     click back to `agentNames.open`, `idle()`, and wait for `Question 158:`.
   - `resetCalls()`, scroll to the top again until `Question 0:` is visible.
   - Checks: (a) `calls.conversationOlder >= 1` in the second scroll (the old pages
     were released and read again); (b) `Question 0:` is visible at the end (the
     history is complete, no gap); (c) `Question 100:` is visible during the second
     scroll (a middle page loads).
   - Write `.openbot-build/web-client-conversation-trim-e2e/report.json` with
     `{ passed, checks }` and exit non-zero on a failure.
   Wait for state (`idle()`, `waitFor` on text), never for a fixed time.

**Verify**: start `bun run storybook`, then
`bun scripts/web-client-conversation-trim-e2e.ts --storybook=<url>` → exits 1 and
check (a) fails (0 older reads, because nothing was released). If (b) fails before
the fix, STOP: the script does not reach the top.

### Step 2: Add the trim

In `web-client-context.tsx`:

1. Add `trimmed?: boolean` to `WebConversation`, with the comment
   `/** The older pages were released; the next latest read takes the host's cursor. */`.
2. Add, near the top of the file, `const LATEST_PAGE_SIZE = 50;` and a function
   `trimToLatestPage(conversation: WebConversation): void` in the shape of the
   desktop function. It works on `conversation.page` (return when the page is
   null or has 50 or fewer messages), keeps the last 50 messages, rebuilds
   `page.references` for the kept replies in the same way, and sets
   `conversation.trimmed = true`. Do not change `page.pageInfo` here.
3. In `select(id)`, inside the existing `setState`, before
   `draft.selectedId = id`: when the previous `draft.selectedId` is set and is
   not `id`, call `trimToLatestPage` on that conversation if it exists.
4. In `load`, change the merge so a trimmed entry takes the host cursor:
   `pageInfo: !older && old && !item.trimmed ? old.pageInfo : page.pageInfo`.
   After the merge, when `!older`, set `item.trimmed = false`.
5. In the delta handler (lines 1093-1110), after a message is appended to the
   page of an agent that is not `draft.selectedId`, call `trimToLatestPage` on
   that conversation.

**Verify**: `bun run typecheck:renderer` → exit 0. The E2E → exit 0, all checks pass.

### Step 3: Run neighbors and write the release note

**Verify**:
- `bun run test:related -- src/renderer/src/features/web-client/web-client-context.tsx` → exit 0.
- `bun run perf:web -- --phases=runtime --runs=1 --storybook=<url>` → exit 0 (the
  existing runtime phase still works).
- `biome check --write --max-diagnostics=none src/renderer/src/features/web-client/web-client-context.tsx src/renderer/src/preview/bench-web-runtime.ts scripts/web-client-conversation-trim-e2e.ts` → exit 0.

Create `changelog.d/<branch>.md` with one `### Changed` item, for example: "The
web app uses less memory when you open many long conversations."

## Test plan

- `scripts/web-client-conversation-trim-e2e.ts` drives the real web workspace in
  the `Web/Workspace/LongConversation` story with Playwright. It proves that the
  older pages of a closed conversation are released and that the whole history
  still loads, with no gap.
- Pattern: the runtime phase of `scripts/web-client-perf-e2e.ts`.

## Done criteria

- [ ] The new E2E exits 0 and its report has `"passed": true`
- [ ] `bun run typecheck:renderer` exits 0
- [ ] `grep -n "trimToLatestPage" src/renderer/src/features/web-client/web-client-context.tsx` shows the function and at least two calls
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` state for 007 is updated

## STOP conditions

- The excerpts in "Current state" do not match the code.
- The web client has gained an "around" window (a page that does not end with
  the newest message). Then trimming the tail can leave a gap; report back.
- The host page size is not 50 (read `readConversationPage` callers in
  `src/main/team-api` or the mock `limit: 50`); report the size.
- The search jump (`openSearchMessage`) stops at a trimmed page in the E2E or in
  manual use.

## Maintenance notes

- If the web client adds an "around" window, the trim must reset it as the
  desktop does with `windowMode`.
- Reviewers: check that `trimmed` is cleared only by a latest read, and that the
  open conversation is never trimmed.
- Deferred: one shared trim helper for desktop and web. The state shapes differ;
  wait for plan work on a shared conversation store.
