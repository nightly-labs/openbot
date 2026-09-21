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

Read [CONTRIBUTING.md](CONTRIBUTING.md#security-sensitive-changes) when a change touches the trust
boundary or a security test, and [architecture change rules](docs/ARCHITECTURE.md#change-rules) when
adding a module or moving ownership between workspaces.

## Product constraints

- Workspaces, conversations, attachments, browser data, and team data stay on the computer that
  runs OpenBot. Providers, visited pages, and plugins can use the network.
- **No cloud dependency for core function.** The app works without an account.
  Cloudflare holds accounts, avatars, host configuration,
  memberships, invitations, and logical sessions; it does not hold chats, files, or commands.
- The user's SQLite database is the source of truth, not a remote cache.
- Agents keep their workspace, thread, and identity across provider switches and restarts.
  Do not reset an agent to simplify state.

## Shared UI

`packages/ui` (`@openbot/ui`) owns shared SolidJS controls and feature components used by
desktop, public web, and Storybook. Reuse these components before adding UI. Import primitives
from `@openbot/ui` and feature components from explicit subpaths such as
`@openbot/ui/features/sidebar/Sidebar`. Do not copy them back into an app.

Keep shared components independent of application contexts, desktop storage, host connections,
and `window.openbot`. Pass data and actions through typed props. Platform adapters and the main
conversation controller stay in the renderer. Component extraction must preserve the existing
UI, styles, and behavior unless the user requests a design change. Native mobile shares brand
tokens and contracts; it does not render SolidJS DOM components.

Read [packages/ui/AGENTS.md](packages/ui/AGENTS.md) before changing shared UI.

## Checks

Do not run broad checks locally. They overload the user's computer. This explicit user preference
replaces the previous full lint and typecheck defaults. Leave repository-wide lint, aggregate
`bun run typecheck`, full UI checks, builds, and full test suites to CI. Do not request these checks
as a routine completion or PR step.

1. In a fresh worktree, run `bun install --frozen-lockfile` first.
2. Run only the narrowest relevant test file and lint the changed files. Run checks one at a time, with one test worker where supported.
   Use `bun run test:desktop -- <path>` for one desktop or mobile test file.
3. Do not run whole-workspace TypeScript checks, `typecheck:*`, or parallel checks. Do not
   replace an aggregate command with its constituent checks. Leave broad type validation to CI
   and state what remains unverified.
4. Do not run `bun run format`: it rewrites the whole repository. Use
   `biome check --write --max-diagnostics=none <paths>` for changed files.

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

- `bun run dev:seed --dry-run` is read-only.
- Never kill by process pattern, such as `pkill -f electron` or `pkill -f bun`. `bun run dev:stop`
  stops only this worktree's stack; name another one with `--pid=<supervisor pid>` or `--all`.
  For a process outside the registry, target a PID you started or ask.
- Never drive another worktree's app. Use `bun run dev:automation` for smoke checks instead of
  starting Electron directly; `snapshot` and `screenshot` are read-only, and `click` and `type`
  need `--allow-mutations` and a named instance.
- Do not delete a dead stack record you did not resolve. Stop keeps the record and exits non-zero
  when it cannot confirm a PID's identity; resolve the process, then `bun run dev:forget`. Dead
  records do not reserve ports.
- Reuse a running dev instance, or use `bun run dev --isolated` for a profile tied to this worktree.
  Use the ports the stack reports rather than a fixed port.

See [README.md — Commands](README.md#commands) for the flags these commands take, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why the registry works this way, when a dev command
does not behave as expected.

## Terms

- **bot** is not for new product code. Released names stay: Team API v1-v3 `bot`/`botId`,
  `bots.json`, `legacy-import:bots:v1`, and `~/OpenBot/Bots` path prefixes.
- **teammate** and **group** are prompt and UI words, never types.

Use [docs/glossary.md](docs/glossary.md) when naming a new type, table, IPC channel or product
string, or when a term in the code disagrees with the UI.

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
  Do not commit screenshots or other PR review image assets to the repository.
- Do not run wider checks locally before a PR. Report focused checks and leave broad checks to CI.
- A PR needs a named reason and is not auto-approvable if it adds `biome-ignore`, `@ts-expect-error`,
  or `@ts-ignore`; disables rules through `biome.json` overrides or removes a GritQL plugin; widens
  a boundary to `any` or `unknown`; or uses an assertion to bypass a checker. Fix the domain issue,
  or explain why the rule is wrong and let the developer decide.
