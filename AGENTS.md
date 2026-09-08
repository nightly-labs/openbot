# Repository guidance

## Communication

Use ASD-STE100 Simplified Technical English for questions, updates, explanations, and final answers.
Keep quotations, code, commands, paths, identifiers, and required technical terms unchanged.

**Non-negotiable** rules protect user data, released contracts, and security. Change them only on
an explicit developer decision. All other rules are defaults: follow the developer's preference
and state which default you set aside. Do not argue by citing this file.

## Non-negotiable

- **Migrations are irreversible.** No backup of `openbot.db` is made before an upgrade. Preserve all
  user data and support every shipped source schema. Never assume a backup exists.
- **Released Team API adapters are permanent.** Do not change a shipped wire protocol's meaning.
- **Keep the renderer-to-main trust boundary:** Electron sandboxing, context isolation, navigation
  policy, IPC sender validation, and their tests. Coding agents already have `danger-full-access`.
- **Redact secrets** on every log, export, and send path, including diagnostics and analytics.
- **Keep PolyForm Noncommercial 1.0.0.** Do not add incompatible dependencies or relicense files.

See [CONTRIBUTING.md](CONTRIBUTING.md#security-sensitive-changes) for the security boundaries and
[architecture change rules](docs/ARCHITECTURE.md#change-rules) for code ownership.

## Product constraints

- Workspaces, conversations, attachments, browser data, and team data stay on the computer that
  runs OpenBot. Providers, visited pages, and plugins can use the network.
- **No cloud dependency for core function.** The app works without an account.
  Cloudflare holds accounts, avatars, host configuration,
  memberships, invitations, and logical sessions; it does not hold chats, files, or commands.
- The user's SQLite database is the source of truth, not a remote cache.
- Agents keep their workspace, thread, and identity across provider switches and restarts.
  Do not reset an agent to simplify state.

## Checks

1. In a fresh worktree, run `bun install --frozen-lockfile` first. Alternatively, run
   `bun scripts/prepare-dev-environment.ts` to also check Bun, migrate local D1, and create the
   untracked `apps/auth-api/.env.dev`. Only `.env.production` needs the encrypted setup.
2. Before completion, run the narrowest relevant test, then `bun run lint` and `bun run typecheck`.
   Also run `bun run check:ui` for changes in `src/renderer`. Keep the full lint and typecheck scope;
   `typecheck:*` includes mobile, Signal, and `remote/scripts`. Each TypeScript project has a
   separate incremental cache in this worktree. The first run creates it; later runs reuse it.
   Run these checks locally even when cache state or machine load makes them slower.
3. Run one desktop test file with `bun run test:desktop -- <path>`. Ask for a specific command
   before a wider test, build, or packaged-app check. Approval covers only that command.
4. Leave `bun run check`, `bun run check:desktop`, `bun run test`, and `bun run build-storybook`
   to CI unless authorized. These suites take minutes and desktop tests can fail under load.
5. Do not run `bun run format`: it rewrites the whole repository. Use
   `biome check --write <paths>` for changed files, or the pre-commit `bun run check:staged` hook.
   Keep `--max-diagnostics=none` for full Biome reports.

[Check design notes](docs/development-checks.md#check-coverage) explain CI coverage, command aliases,
and the separate Node and Bun type environments. Read them when changing checks or dependencies.

## Surfaces to check

State which surfaces a change touches. Check all affected consumers and reverse actions.

- Desktop renderer (`src/renderer`), mobile (`apps/mobile`), public web (`apps/auth-api`; no separate
  landing app), hosted-site routing (`apps/site-router`), and Signal (`remote/api`).
- IPC contracts (`packages/contracts`) and their preview implementation
  (`src/renderer/src/preview/mock-openbot.ts`).
- Reverse actions: snooze/unsnooze, pause/resume, revoke/reconnect, mute/unmute.
- Migrations and the separate latest schema for new databases.
- Documentation: `README.md` commands, `docs/ARCHITECTURE.md`, and `PRIVACY.md` when outbound data
  changes.

## Development data and processes

- Never run `bun run dev:seed` or `bun run dev:reset` unless asked. Seed replaces the whole
  `OpenBot Dev` profile and deletes its staging copy on success. Reset deletes app, test-client,
  and legacy host profiles. `bun run dev:seed --dry-run` is read-only.
- Reuse a running dev instance, or use `bun run dev --isolated` for a profile tied to this worktree.
  Dev and Storybook allocate ports through a shared registry; use the ports they report. A second
  dev stack in the same worktree requires `--force`.
- Use `bun run dev:automation` for smoke checks instead of starting Electron directly.
  `instances` lists worktrees, profiles, and ports. `snapshot` and `screenshot` are read-only.
  `click` and `type` require `--allow-mutations` and a named instance: this worktree's record,
  `--instance=<id>`, or `--port=`. Never click another worktree's app.
- `pages` lists all window targets. Use `--page=<target-id|url-substring>` for any target, including
  Dynamic Island or embedded browser views; the default is the app window. Use
  `--wait-for=<role>,<name>` to wait for an accessible target before capture and after mutation.
- Never kill by process pattern, such as `pkill -f electron` or `pkill -f bun`.
  `bun run dev:status` lists all stacks. `bun run dev:stop` stops only this worktree's stack.
  Use `--pid=<supervisor pid>` to name another stack or `--all` to name all stacks explicitly.
- Stop checks each PID's start time. If identity cannot be confirmed, it keeps the record and
  exits non-zero. Resolve the process first, then use `bun run dev:forget` to remove its record.
  Dead records do not reserve ports; readers must not delete them. For a process outside the
  registry, target a PID you started or ask.

## Terms

- **agent**: the product object (`AgentStore`, `AgentSummary`, `agent-${uuid}`,
  `~/OpenBot/Agents/<id>`, `projection_agents`), a coding agent, or a marketplace agent
  (`ipc-marketplace-agents.ts`). **teammate** is prompt and marketing text, never a type.
  Human members use `TeamMemberSummary`.
- **bot**: do not use for new product code. Keep released names: Team API v1-v3
  `bot`/`botId`/`bots-changed` (`current-agent-keys.ts` translates), `bots.json`, `mailbox.json`,
  `legacy-import:bots:v1`, and readable `~/OpenBot/Bots` path prefixes. Accept `bot-<uuid>` IDs from
  databases that did not run migration v13. `"first-bot"` is an avatar seed; `BloubBot` and the
  lucide `Bot` icon are library names.
- **channel**: the shared multi-agent chat (`ChannelStore`, `ChannelSummary`, `projection_channels`,
  `channel-chats-v1`). **group** is not a product term: it means a sidebar section
  (`SidebarPinnedGroup`, `create_section`), an IPC endpoint group (`IpcEndpointGroup`,
  `define-ipc-group.ts`), or an ARIA `role="group"`. An IPC **channel** is a wire name in
  `IPC_CHANNELS` (`ipc-channels.ts`); the product contract is `ipc-chat-channels.ts`.
- **server**: a joined team server (`ServerSummary`, `servers:*`), the local Team API host
  (`HostStatus`, `host:*`, `src/main/team-api-server.ts`), the account API (`apps/auth-api`,
  `auth:*`), or an MCP server (`createSdkMcpServer`).
- **thread**: durable `projection_threads` record. **conversation**: its read projection, with no
  separate table. **provider session**: private CLI resume state (`projection_provider_sessions`).
  **team session**: authenticated remote connection. **turn**: one exchange in a thread.
- **routine**: a scheduled instruction for one agent (`projection_agent_routines`), not Claude
  Code `/schedule`.

## Task-specific instructions

Read the instruction file for each directory you change. Use the
[workspace map](docs/ARCHITECTURE.md#workspace-map) to find its owner.

| File | Scope |
| --- | --- |
| [src/renderer/AGENTS.md](src/renderer/AGENTS.md) | SolidJS, stores, components, palette |
| [src/main/AGENTS.md](src/main/AGENTS.md) | Renderer-to-main boundary and main-process ownership |
| [src/main/ipc/AGENTS.md](src/main/ipc/AGENTS.md) | Handler binding and endpoint registration |
| [src/backend/AGENTS.md](src/backend/AGENTS.md) | SQLite migrations and database creation |
| [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md) | Frozen Team API protocols and IPC mirrors |
| [apps/auth-api/AGENTS.md](apps/auth-api/AGENTS.md) | Account Worker and D1 deployment races |
| [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md) | Expo and build/simulator permissions |

Before a version bump or tag, use
[release-upgrade-safety](.agents/skills/release-upgrade-safety/SKILL.md) to audit upgrade and data-loss
risks since the last release.

## Tests

- Prefer an existing test. Add a test only for a user or caller consequence; add a file only for a
  new boundary. Skip assertions already enforced by TypeScript, Biome, or `check:ui`.
- Tests are mandatory for changes to the renderer-to-main boundary, IPC contracts, database schema
  and migrations, persisted state, secrets, provider processes, Team API wire protocols, and the
  updater. Test once at the lowest stable boundary.
- For each added assertion, break the behavior and confirm the test fails for the intended reason.
  Restore the code and report this check in the PR.
- Wait for state, an event, or a promise, not elapsed time. A spy can provide the wait condition,
  such as `await waitFor(() => expect(send).toHaveBeenCalled())`; assert the user consequence after
  that wait. Do not remove synchronization because it uses a spy.
- Assert behavior and data. Query accessible roles and names; use `toHaveFocus()` for focus.
  Do not assert markup, classes, layout, animation timing, or snapshots. Use exact text only for
  product contracts, error/security messages, serialized output, or localization keys.
- Use Storybook for visual details. Do not add test IDs to avoid missing accessibility.
  Story play functions can use them; renderer `data-testid` use must stay within the existing
  `check:ui` budget of five. A new hook must replace an existing one.
- `*.test.ts` uses Node; `*.test.tsx` uses JSX and jsdom; `*.dom.test.ts` uses DOM without a
  component. Keep pure logic in Node tests.

### Check rules

- Fix errors. Assess warnings; do not make correct code worse to silence one. Do not add
  `biome-ignore`. Explain retained warnings in the PR.
- GritQL rules must match syntax, not infer domain decisions, and must not duplicate a built-in
  Biome rule. Consider traversal cost before adding a rule.
- Each rule in `tools/biome/anti-slop/rules` needs positive and negative fixtures in `../fixtures`.
  Mark rejected lines with `// flag`; verify with `scripts/anti-slop-rules.test.ts`.
- Each UI check needs both `renderer` and `renderer-clean` fixtures in `tools/ui-foundation/fixtures`.
  Verify with `scripts/ui-foundation-check.test.ts`.

Read [check design notes](docs/development-checks.md#lint-and-ui-rules) when changing these checks.
They describe the enforced syntax, fixture behavior, and reasons for removed rules.

## Pull requests

- Open a PR only when asked.
- For UI changes, show before and after. State the model and harness in the PR body.
- Get approval for a specific wider check and run it before opening the PR.
- A PR needs a named reason and is not auto-approvable if it adds `biome-ignore`, `@ts-expect-error`,
  or `@ts-ignore`; disables rules through `biome.json` overrides or removes a GritQL plugin; widens
  a boundary to `any` or `unknown`; or uses an assertion to bypass a checker. Fix the domain issue,
  or explain why the rule is wrong and let the developer decide.
