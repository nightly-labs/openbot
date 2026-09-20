# Development check design notes

These notes explain the checks referenced by [repository instructions](../AGENTS.md#checks).
Read the relevant section when changing CI, dependencies, or lint rules. Routine tasks use the
short command list in `AGENTS.md`.

## Check coverage

Full lint and typecheck read more than the changed files. A shared export can break desktop,
mobile, or a service outside the edited project. Lint uses
`biome check --max-diagnostics=none .`: the default diagnostic limit hides findings after the first
20 even though the reported total includes them. `bun run format` adds `--write` to the full scan;
this is why routine fixes target paths or use the staged-file hook.

The aggregate typecheck selects `typecheck:*`. Mobile was previously named only `mobile:typecheck`
and was omitted. It now has `typecheck:mobile`; the old name remains an alias for CI. Mobile uses
`@openbot/brand`, `@openbot/contracts`, and `@openbot/team-client`. Its Expo and Uniwind generation
writes ignored files before TypeScript runs.

Signal had a similar gap: `remote:check` was its only entry point and also required Compose
validation. `typecheck:remote` and `test:remote` now run in CI. `remote:check:compose` validates both
Compose files with the Docker CLI; it does not need a daemon. `remote:check` remains the combined
local command.

`remote/api/tsconfig.json` also covers `remote/scripts/*.ts`. These scripts use Bun, while root
`scripts/**` and Electron main use Node types. Keep Bun types within the remote project rather than
adding Bun globals at the root. `remote/scripts/update.ts` drains and recreates the live coturn
container, so its type coverage matters.

The Signal Dockerfile installs from a pruned checkout with one manifest copy per workspace.
CI does not build that image. `scripts/dependency-catalog.test.ts` checks that the copied manifests
cover the workspace dependency graph; keep that check when changing workspace dependencies.

The source of truth for CI is [.github/workflows/ci.yml](../.github/workflows/ci.yml).
Its main jobs are:

| Job | Runner | Commands |
| --- | --- | --- |
| Check | `ubuntu-latest` | `bun run check:desktop:static` |
| Browser smoke | `ubuntu-latest` | `xvfb-run -a bun run test:browser` |
| Tests | `ubuntu-latest` | `bun run test:desktop`, `bun run test:sites`, `bun run test:remote` |
| Surfaces | `ubuntu-latest` | `bun run mobile:typecheck`, `bun run typecheck:sites`, `bun run typecheck:team-client`, `bun run typecheck:remote`, `bun run remote:check:compose` |
| API | `ubuntu-latest` | `bun run check:api` |
| Storybook build | `ubuntu-latest` | `bun run build-storybook` |

All six gate Cloudflare production deployment on `main`. Surfaces was previously missing from
that dependency list, which allowed deployment despite a failed mobile or remote check.
These long suites belong in CI; local desktop runs can reach their time limits under load.

`bun run check:desktop` still runs everything: it is `check:desktop:static`, which holds the UI
check, the lint, the desktop typecheck and the build, followed by the browser smoke test. CI is
the only caller that splits them. The smoke test starts the real Electron binary, so it runs under
xvfb on Ubuntu rather than on a macOS runner, and reads nothing the build writes, so the order
between the halves is free. `release.yml` keeps the whole of `check:desktop` on one macOS runner,
where it checks the machine that builds the release.

`setup-bun` restores the Bun package store before installing. The key falls back through
`restore-keys`, so a lockfile change re-downloads only what moved. The Electron download is
deliberately not cached: `install-electron` takes 2.6s on a runner, and a measured cache hit
restored 123 MB in 4.4s and left `bun install` at 29.9s against 29.0s with no cache at all.

## Why the jsdom projects use `vmThreads`

`test:desktop` is not slow because of test count. The 54 `renderer` files hold 732 of the 3401
tests and take three quarters of the run, and what cost the most was per-file setup rather than
anything in the tests: building a jsdom for each file was 61.8s of a 176.7s CI run. So the
`renderer` and `mobile-ui` projects use `pool: "vmThreads"`: one jsdom per worker, and a module
registry per file inside a VM context. That took the full suite from 118.7s to 92.6s locally.

The mounts themselves are not the cost, which is worth recording because the file sizes suggest
otherwise. Measured on one worker: `installOpenbotStub()` is 0.4ms, `AppProviders` with a probe
under it is 4.3ms, and a full `<App />` is 21.8ms, of which the view tree is 17.4ms. Dividing a
file's total time by its render count attributes the whole test to the mount and overstates it by
more than twenty times. Two other theories also measured close to nothing: the 50ms `waitFor` poll
interval is worth 9% on the worst file, because `waitFor` runs its callback once before it polls
and the condition is usually already true.

Isolation is the reason that pool was chosen over the faster `isolate: false`. The renderer files
share module-level store state, so without a per-file registry they pass only in the order vitest
happens to pick: `--sequence.shuffle.files` fails eight files under `isolate: false` and passes
under both `vmThreads` and the previous `forks` default. Use that flag when changing pool settings;
a green run in the default order proves nothing here.

The `node` project stays on isolated `forks`. Its files register IPC handlers and read
per-process globals, so they fail on `threads` whether or not isolation is on, and on `vmForks`
they fail on the filesystem; it also spends its time in the tests themselves rather than in
environment setup, so it has little to gain.

The worker count is left to vitest. It uses one less than the machine reports, and the runner
reports four vCPUs, so it runs three. Asking for a fourth is slower, not faster - 125.7s against
100.6s - because the workers then contend with the main process.

Compare pool settings with the summed `tests` phase divided by the wall clock, not the wall clock
alone. The wall clock is not usable evidence on its own: five runs of one commit, with nothing
changed between them, took 106.7s, 131.8s, 134.0s, 134.1s and 141.5s, a spread of 33%. Two runs of
a config change will therefore agree with almost any conclusion, and reading one slow run as a
worker-count change cost a wrong commit here.

The ratio is stable where the wall clock is not, because it says how many workers were actually
busy: it held between 1.99 and 2.08 across all seven runs on three workers, at durations from 100.6s
to 141.5s, and reached 2.64 on four. Use it, or repeat the run, before believing a pool change.

`deps.optimizer` is not enabled: it left `import` unchanged, at 26.1s against 26.2s, because that
phase is this repository's own module graph re-executing per file rather than dependency resolution.

### The `App.*.test.tsx` files are not at the wrong boundary

`App.read-state.test.tsx` is the largest test file in the repository, and moving its tests down to
`AppProviders` with no view was investigated and rejected. Of its 27 `render(() => <App />)` tests,
22 assert the rendered result - the `"1 new message"` badge, the `"New messages"` separator, or
`"Responded"` on a sidebar row - and the remaining five drive through the view, opening an agent or
switching servers by clicking it. None mounts the view without using it. Read state spans IPC, the
conversation store, window focus, which surface covers the conversation, and the badge, so the
application is the lowest boundary at which those tests hold together.

The five tests that genuinely need no view already use the `AppProviders` harness with a probe
underneath, and that is the pattern to follow for a new test that asserts only state. Reach for it
when a test asserts state; do not convert a test that asserts the badge into one that asserts a
probe, because the badge is the behaviour.

The development setup script checks Bun, migrates local D1, and creates a missing
`apps/auth-api/.env.dev`. This file is per-machine and untracked. Only `.env.production` remains
encrypted; a missing `.env.keys` does not block ordinary local setup.

## Lint and UI rules

Biome rejects these patterns in tests: `toHaveClass`, `toHaveStyle`, `getComputedStyle`,
`toContainElement`, `toHaveAttribute("title", …)`, `expect(x.innerHTML)`, DOM-tree walks,
`querySelector("svg" | "img")`, `document.activeElement`, snapshots, `*ByTestId` queries,
assertions reached through CSS classes, an awaited bare `setTimeout`, and `it.only`.
Use `toHaveFocus()` to name the element whose focus matters. Storybook stories are the place for
visual checks and play functions.

GritQL cannot connect a test query to the product's `data-testid` attribute. `check:ui` checks the
renderer attribute budget separately. The budget is five because existing story play functions
use three of those hooks. It permits replacement, not growth.

`check:ui` also detects CSS classes that no component, story, or HTML entry point names. This found
about 1,400 lines of unused CSS. A dynamic `prefix-${value}` counts as a use only inside a class
attribute; the same template in an ID must not keep unrelated CSS alive.

Errors cover prohibited syntax. Warnings ask for judgment, such as an `object` parameter or a
module mock. Making correct boundary code worse to remove a warning defeats the check. A spy call
can synchronize an async test; the assertions after that wait must prove behavior.

Every GritQL rule has rejected examples marked `// flag` beside accepted examples. This matters
because a rule that matches nothing passes without enforcing anything. One rule failed to detect
`querySelector<HTMLElement>` until its fixture covered that spelling.

The UI fixtures have two trees. `renderer` breaks every check beside valid examples.
`renderer-clean` breaks none. Both are needed: a check that reports once per file can falsely reject
a valid example without changing the failure count in the first tree.

### Removed rules and their limits

- `no-runtime-typeof` could not distinguish valid narrowing of `unknown` at a trust boundary from
  redundant checks of known values. All sixteen warnings were valid uses. The false positives
  made other warnings easier to overlook.
- `no-chained-type-assertions` repeated Biome's `noUnsafeTypeAssertion` and missed the
  unparenthesized `value as unknown as T` spelling. `noExplicitAny` already covers `any`.
- `no-shape-in-symbol-names` enforced a naming preference with a `const $name = $value` pattern.
  Each plugin traverses the files separately, and that common pattern cost more than the rest of
  the linter. Review can handle a naming decision without that cost.

A new rule must reject a specific syntax, leave valid neighboring code alone, and add coverage
that the existing checks do not provide.
