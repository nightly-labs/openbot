# Repository guidance

## Communication

Use ASD-STE100 Simplified Technical English for all text you write: questions, updates,
explanations, final answers, commit messages, PR descriptions, and review comments. Be as concise as
possible. Keep quotations, code, commands, paths, identifiers, and required technical terms unchanged.

When a step doesn't need the developer's input, keep going. Put status notes in the same message as
your next action. Stop and ask only when you can't continue without the developer, or before
anything destructive: deleting data, force-pushing, or changing anything outside this repository.

For work with more than a few steps, keep a checklist in `TASKS.md` at the worktree root (git
ignores it). Tick each item when it is done, and add new items that you find. The file stays
available after the context is summarized.

For an audit or migration that divides into independent areas, give each area to its own subagent.
Check the evidence in each subagent's report before you accept it. Finish with one table.

Mark each claim that you could not confirm, and say where you looked.

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
boundary or a security test, and [architecture change rules](docs/architecture/change-rules.md#change-rules) when
adding a module or moving ownership between workspaces.

## Product constraints

- Workspaces, conversations, attachments, browser data, and team data stay on the computer that
  runs OpenBot. Providers, visited pages, and plugins can use the network. Exception: a signed-in
  phone keeps an encrypted, read-only copy of the agents, sections, recent chats, channels and drawer
  values of its servers (`apps/mobile/src/features/workspace/model/workspace-cache.ts`). The copy stays
  on that phone, the host stays the source of truth, and sign-out, session expiry and server removal delete it.
  A desktop or browser client also keeps a copy of the agent and channel pictures that it loaded from a
  joined server (`src/main/remote-picture-cache.ts`,
  `src/renderer/src/features/web-client/web-agent-pictures.ts`), so the saved workspace shows the agent
  pictures while the host is offline. Sign-out, server removal and the end of access delete it.
- Cloudflare holds accounts, avatars, host configuration, memberships, invitations, and logical
  sessions; it does not hold chats, files, or commands. It also holds the signed JavaScript bundles
  of mobile over-the-air updates (`apps/mobile-updates`), which are public code and have no user data.
- The user's SQLite database is the source of truth, not a remote cache.
- Agents keep their workspace, thread, and identity across provider switches and restarts.
  Do not reset an agent to simplify state.

## Joined servers

Many users run OpenBot only on a joined server: a VPS, a hosted server, or another member's computer.
A feature for agents, chats, channels, routines or server settings must work there as it does on
this computer. Make it local only when it needs this computer itself: its files and folders, its
windows, its OS dialogs or its native notifications.

- Ship the remote path in the same change as the local one: the host route in `src/main/team-api/`,
  a new optional capability in `packages/contracts/src/team-protocol/` (see
  [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md)), the `remote` branch of the IPC
  handler, and each client: the desktop with a joined server, the web client
  (`src/renderer/src/features/web-client/`), and mobile (`apps/mobile`) when the action fits a phone.
- Do not add a `remote` branch that always throws or returns empty data, or a `kind === "local"`
  gate, for a feature that can work on a server. When a part must stay local, write the reason at
  the gate and in the PR.
- Gate the client on the host capability. Hide the action while the host does not have it; do not
  show an action that then fails. An older host keeps working without the feature.
- Test the host route through the Team API (as `scripts/team-api-routes-e2e.ts` does), not only the
  local IPC path.
- A server installs a staged release only at its next boot, or when an owner, an admin or a permitted
  member installs it in Server Settings > Updates. When a feature needs the new host, the release
  notes say that the server must also be on the new version.

## Effect

- Use Effect 4.0.0 for migrated server and desktop domain services, schemas, typed errors,
  asynchronous workflows, and external I/O. Keep the Bun catalog and lockfile aligned.
- Read the installed Effect source and documentation. Do not use v3 compatibility aliases.
- Prefer named `Effect.fn`, `Effect.gen`, `Context.Service`, explicit layers, and `Schema.TaggedError`.
- Derive validated domain types from schemas. Decode untrusted values at their boundary;
  preserve released decoder behavior. Do not validate trusted internal values again.
- Wrap expected I/O failures with `Effect.tryPromise` or `Effect.try` at the adapter.
  Keep causes private and safe. Preserve public error codes and localized messages.
- Run Effects at framework boundaries. Keep routing, request schemas, rendering, and callbacks native.
  Expose one Effect-returning operation per async service method. Do not add paired Promise methods
  or run an Effect only to wrap its Promise in another Effect. Adapt browser and mobile native
  callbacks at their call sites; preserve released wire and event contracts.
- Reuse process-owned managed runtimes and await disposal in existing shutdown paths. Preserve
  desktop teardown ordinals. Worker bindings and background I/O belong to their invocation;
  retain `waitUntil` and streaming lifetimes rather than adding a process shutdown hook.
- Tie owned resources to finalizers. Preserve existing deadlines and retries, and forward cancellation
  where the API supports it. Do not add generic retry, fallback, or service-wrapper policies.
- Keep business authorization and validation in domain operations, and centralize public error mapping.
- The database host may import `effect` in addition to `node:*`. It remains a separate killable process
  and must not import Electron or the application database. Effect cannot interrupt blocked SQLite.
- Test through injected boundaries and include affected tests in CI selections. Mobile and browser
  application workflow migration is outside this change; shared package consumers still need checks.

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

## Interface text

Text that a user reads comes from `@openbot/i18n` catalog keys, on desktop, web and mobile. Do not
write a literal. Errors that the main process, backend or team client send use `sourceText(key)`.
Read [docs/i18n.md](docs/i18n.md) before adding a key or a language.

## Checks

Do not run broad checks locally. They overload the user's computer. This explicit user preference
replaces the previous full lint and typecheck defaults. Leave repository-wide lint, aggregate
`bun run typecheck`, full UI checks, builds, and full test suites to CI. Do not request these checks
as a routine completion or PR step.

1. In a fresh worktree, run `bun install --frozen-lockfile` first.
2. Run only the narrowest relevant test file and lint the changed files. Run checks one at a time, with one test worker where supported.
   Use `bun run test:changed` by default: it runs, on one worker, only the desktop and mobile test
   files that import a file you changed since `origin/main`. Use `bun run test:related -- <source>`
   for the tests of named source files, and `bun run test:desktop -- <path>` for one test file.
3. To check types, run one project for the code you changed, one at a time:
   `bun run typecheck:node` (`src/main`, `src/backend`, `src/preload`, `scripts`),
   `bun run typecheck:renderer` (`src/renderer`, `packages/ui`), or the `typecheck` script of the
   one package or app you changed. Each takes under 10 seconds. Do not run `bun run typecheck`, the
   mobile typecheck, or parallel checks. Leave broad type validation to CI and state what remains
   unverified.
4. Do not run `bun run format`: it rewrites the whole repository. Use
   `biome check --write --max-diagnostics=none <paths>` for changed files.
5. The pre-commit hook (`.githooks/pre-commit`) runs `check:staged`, `check:ui`, and
   `scripts/staged-typecheck.ts` when the commit stages code. The script runs, one at a time, only
   the `typecheck:*` projects that can see a staged file; a root `package.json`, `tsconfig*.json` or
   `bun.lock` selects all of them. `--dry-run [<path>...]` shows the selection. This is the only
   exception to rule 3. Do not run these checks by hand, and do not bypass the hook with
   `--no-verify`. The hook also runs the schema parity test when a database schema file in
   `src/backend` is staged. It stops the commit if Biome fixes a file that also has unstaged
   changes; stage the fixes you want and commit again.

[Check design notes](docs/development-checks.md#check-coverage) explain CI coverage, command aliases,
and the separate Node and Bun type environments. Read them when changing checks or dependencies.

## Surfaces to check

State which surfaces a change touches. Check all affected consumers and reverse actions.

- Desktop renderer (`src/renderer`), mobile (`apps/mobile`), public web (`apps/auth-api`; no separate
  landing app), hosted-site routing (`apps/site-router`), the mobile update server
  (`apps/mobile-updates`), and Signal (`remote/api`).
- Joined servers: the desktop with a joined server, the web client (`openbot.run/app`), and mobile.
  See [Joined servers](#joined-servers).
- IPC contracts (`packages/contracts`) and their preview implementation
  (`src/renderer/src/preview/mock-openbot.ts`).
- Reverse actions: snooze/unsnooze, pause/resume, revoke/reconnect, mute/unmute.
- Migrations and the separate latest schema for new databases.
- Documentation: `README.md` commands, `docs/architecture/`, and `PRIVACY.md` when outbound data
  changes.

## Development data and processes

### Account service environment settings

- Maintain only `apps/auth-api/.env.dev` and `apps/auth-api/.env.production` for shared account
  service settings. Add new settings to these files; do not add another environment file.
- Keep both files encrypted. Development uses `DOTENV_PRIVATE_KEY_DEV`; production uses
  `DOTENV_PRIVATE_KEY_PRODUCTION`. Never use production credentials as local development defaults.
- Use the development loader. It reads the development key from the shell; without the key,
  local development must work with generated defaults. Commands that need external secrets must
  stop before remote changes when those secrets are missing. An invalid key must fail safely.
- Keep generated identity and saved local overrides in ignored `.openbot/dev-state.json`.
  New manual overrides use shell variables. Do not add `.env.local` or `.env.generated`.
- `.env.keys` stores decryption keys, not service settings. Keep it ignored. Preserve existing
  production key handling and CI/GitHub secrets unless the developer requests a change.
- The root `.env.keys` holds the only two keys: `DOTENV_PRIVATE_KEY_PRODUCTION` and
  `DOTENV_PRIVATE_KEY_DEV`. Every encrypted env file, `remote/.env.production` included, uses one of
  them. Never make a new key pair. Pass `-fk` with the root `.env.keys` so Dotenvx does not make one.
- For direct Cloudflare changes, `apps/auth-api/.env.production` holds `CLOUDFLARE_API_TOKEN`
  (write access to all resources in the OpenBot account) and `CLOUDFLARE_ACCOUNT_ID`. Load them
  with `bunx dotenvx run -f apps/auth-api/.env.production -fk <root>/.env.keys -- <command>`. A worktree
  has no `.env.keys`; use the one in the main checkout. Never print the token: do not use
  `dotenvx get` or `echo`. Ask before a change that deletes data or affects production users.
  Deploy scripts remove the token, so Wrangler deploys keep the developer's `wrangler login`.
- For provider harness tests and smoke checks, `apps/auth-api/.env.dev` holds `INCEPTION_API_KEY`
  (Inception Labs, OpenAI-compatible, `https://api.inceptionlabs.ai/v1`, models such as `mercury-3`).
  Load it with `bunx @dotenvx/dotenvx@2.38.2 run -f apps/auth-api/.env.dev -fk <root>/.env.keys --
  <command>`; `bun run dev` does not pass it on. Never print it. Ask before a benchmark or a run of many
  turns: the token budget is small.
- For development and manual tests, the team has one test Google account. `apps/auth-api/.env.dev`
  holds `DEV_TEST_GMAIL_ADDRESS` and `DEV_TEST_GMAIL_PASSWORD`. Use it to sign in to Gmail and to
  third-party services ("Sign in with Google") for development and smoke checks, never for a
  personal or production account. Load it the same way as `INCEPTION_API_KEY`, and never print it.
  Its X account uses the same email and password. A Google sign-in from a new browser gets a phone
  check that only the developer can do. To skip it, load the saved session into a new browser
  context (Playwright `storageState`) from `~/.config/openbot/test-google-account.storage.json` on
  the developer's Mac. For the OpenBot browser, open a tab over CDP and set the same cookies with
  `Network.setCookies` on that tab: agents share that session. If that session has expired, ask the
  developer to do the phone check, then save the session again.

See [account service setup](apps/auth-api/README.md) for loading and deployment details.

### Leaseweb servers

Take only a Leaseweb VPS that has no reference, and set its reference before any other work on it.
Never take a VPS that has a reference, also `pool`. The reference scheme is in
[Leaseweb references](docs/hosted-servers.md#leaseweb-references). To set up a VPS as the server of one
customer, use the [custom-server](.agents/skills/custom-server/SKILL.md) skill. The customer is the
owner, through a server claim; never sign the server in to an operator account.

### Local processes

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
- Reuse a running dev instance. `bun run dev` opens a profile tied to this worktree; `--shared`
  opens the shared `OpenBot Dev` profile. Use the ports the stack reports rather than a fixed port.

See [README.md — Commands](README.md#commands) for the flags these commands take, and
[docs/architecture/change-rules.md](docs/architecture/change-rules.md#change-rules) for why the registry works this way, when a dev command
does not behave as expected.

## Terms

- **bot** is not for new product code. Released names stay: Team API v1-v3 `bot`/`botId`,
  `bots.json`, `legacy-import:bots:v1`, and `~/OpenBot/Bots` path prefixes.
- **teammate** and **group** are prompt and UI words, never types.

Use [docs/glossary.md](docs/glossary.md) when naming a new type, table, IPC channel or product
string, or when a term in the code disagrees with the UI.

## Task-specific instructions

Read the instruction file for each directory you change. Use the
[workspace map](docs/architecture/structure.md#workspace-map) to find its owner.

| File | Scope |
| --- | --- |
| [src/renderer/AGENTS.md](src/renderer/AGENTS.md) | SolidJS, stores, components, palette |
| [src/main/AGENTS.md](src/main/AGENTS.md) | Renderer-to-main boundary and main-process ownership |
| [src/main/ipc/AGENTS.md](src/main/ipc/AGENTS.md) | Handler binding and endpoint registration |
| [src/backend/AGENTS.md](src/backend/AGENTS.md) | SQLite migrations and database creation |
| [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md) | Frozen Team API protocols and IPC mirrors |
| [apps/auth-api/AGENTS.md](apps/auth-api/AGENTS.md) | Account Worker and D1 deployment races |
| [src/preload/AGENTS.md](src/preload/AGENTS.md) | Preload bridge and payload decoding |
| [packages/ui/AGENTS.md](packages/ui/AGENTS.md) | Shared SolidJS controls and feature components |
| [packages/team-client/AGENTS.md](packages/team-client/AGENTS.md) | Team WebRTC client and framing |
| [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md) | Expo and build/simulator permissions |
| [remote/api/AGENTS.md](remote/api/AGENTS.md) | Signal and TURN credentials |

Write release notes in a new `changelog.d/<branch>.md` file, not in `CHANGELOG.md`, as
[docs/RELEASING.md](docs/RELEASING.md#release-notes) says. Notes for the iPhone app go in
`apps/mobile/changelog.d/<branch>.md`. CI fails a PR with no notes unless it
has the `no-changelog` label. A version bump with no notes fails.

Before a version bump or tag, use
[release-upgrade-safety](.agents/skills/release-upgrade-safety/SKILL.md) to audit upgrade and data-loss
risks since the last release.

## Tests

- Use E2E tests only. Do not add unit tests. An E2E test is a script under `scripts/` (such as
  `scripts/*-e2e.ts` or `scripts/*-smoke.ts`) that drives the real app, process or service. At the
  end, it writes a verifiable and repeatable artifact, such as a JSON report or a screenshot under
  `.openbot-build/`.
- Vitest files are permitted only for these protected areas:
  - Database migrations: data-preservation fixtures for every affected released schema, plus the
    failure and rollback cases that [src/backend/AGENTS.md](src/backend/AGENTS.md) lists. A
    migration always needs them.
  - The renderer-to-main trust boundary: sender validation, navigation and permission policy, CSP,
    sandboxing, and preload payload decoding.
  - Secret redaction on log, export, and send paths.
  - Lint and UI check rule fixtures (see [Check rules](#check-rules)).
- Do not assert what TypeScript, Biome, or `check:ui` already enforce.
- Wait for state, an event, or a promise, not elapsed time.
- Assert behavior and data. Do not assert markup, classes, layout, animation timing, or snapshots.
- Use Storybook for visual details only. Do not add story `play` functions: CI does not run them.
  Do not add `data-testid` hooks; `check:ui` allows none.
- `*.test.ts` uses Node; `*.test.tsx` uses JSX and jsdom; `*.dom.test.ts` uses DOM without a
  component.

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
- Write the PR body from `.github/PULL_REQUEST_TEMPLATE.md`. Organization members and users with
  write access do not sign the Contributor License Agreement. An author who must sign sends a signed
  PDF by email. Never sign, fill in, or send the agreement for the author.
- For UI changes, show before and after. State the model and harness in the PR body.
  Do not commit screenshots or other PR review image assets to the repository.
- Do not run wider checks locally before a PR. Report focused checks and leave broad checks to CI.
- A PR needs a named reason and is not auto-approvable if it adds `biome-ignore`, `@ts-expect-error`,
  or `@ts-ignore`; disables rules through `biome.json` overrides or removes a GritQL plugin; widens
  a boundary to `any` or `unknown`; or uses an assertion to bypass a checker. Fix the domain issue,
  or explain why the rule is wrong and let the developer decide.
