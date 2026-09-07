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
| Check | `macos-14` | `bun run check:desktop` |
| Tests | `ubuntu-latest` | `bun run test:desktop`, `bun run test:sites`, `bun run test:remote` |
| Surfaces | `ubuntu-latest` | `bun run mobile:typecheck`, `bun run typecheck:sites`, `bun run typecheck:team-client`, `bun run typecheck:remote`, `bun run remote:check:compose` |
| API | `ubuntu-latest` | `bun run check:api` |
| Storybook build | `ubuntu-latest` | `bun run build-storybook` |

All five gate Cloudflare production deployment on `main`. Surfaces was previously missing from
that dependency list, which allowed deployment despite a failed mobile or remote check.
These long suites belong in CI; local desktop runs can reach their time limits under load.

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
