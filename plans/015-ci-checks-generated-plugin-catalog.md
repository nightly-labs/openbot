# Plan 015: Check generated plugin catalogs in CI

> **Executor instructions**: Follow this plan step by step. If a STOP condition occurs, stop and report.
>
> **Drift check**: `git diff --stat 20d1cd63d9..HEAD -- scripts/build-plugin-catalog.ts package.json .github/workflows/ci.yml marketplace/plugin-catalog`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `20d1cd63d9`, 2026-11-23

## Why this matters

The plugin catalog source generates renderer, Worker, mobile, and offline snapshot modules. The generator already supports `--check`, but CI does not run it. A stale generated file can make different OpenBot surfaces show different plugins or install metadata while all current checks pass.

## Current state

- `scripts/build-plugin-catalog.ts:634-636` tells contributors to run `bun run marketplace:build:plugins -- --check`.
- `package.json:528` defines `marketplace:build:plugins`.
- `docs/plugin-distribution.md:470-473` records that catalog freshness has no CI check.
- `.github/workflows/ci.yml` static checks include asset, links, migrations, translations, and type options, but no plugin-catalog check.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Catalog check | `bun run marketplace:build:plugins -- --check` | exit 0 with no generated diff |
| Changed-file lint | `bunx biome check --max-diagnostics=none .github/workflows/ci.yml` | exit 0 |

## Scope

**In scope**

- `.github/workflows/ci.yml`
- `docs/plugin-distribution.md` if the status text must be updated
- Generated catalog files only when the check proves they are stale

**Out of scope**

- Plugin catalog schema or route design
- Marketplace UI behavior
- New plugin listings
- Release workflow changes beyond the deterministic freshness check

## Steps

### Step 1: Confirm the generator is clean

Run the generator check at the planned commit. If it fails, regenerate the tracked outputs, inspect the diff, and keep only changes caused by the current catalog source.

**Verify**: `bun run marketplace:build:plugins -- --check` → exit 0.

### Step 2: Add the CI check

Add one static CI command in the existing code-check lane. Run it when catalog source or generator inputs change, or in the existing static lane if the lane already runs on all code changes. Keep the command exactly aligned with the documented `--check` invocation.

**Verify**: `bunx biome check --max-diagnostics=none .github/workflows/ci.yml` → exit 0.

### Step 3: Update the design note

If the CI check is now present, update the sentence in `docs/plugin-distribution.md:470-473` so it no longer says that no CI job runs `--check`. Keep the open Worker route work separate.

**Verify**: `bun run check:doc-links` → exit 0.

## Test plan

Run the generator check locally. For CI behavior, inspect the changed-path condition and ensure a catalog source change selects the check. Do not add a unit test for a workflow expression.

## Done criteria

- [ ] CI runs the catalog freshness check.
- [ ] A stale generated output fails the check with a clear command.
- [ ] A clean checkout passes the check.
- [ ] Any status documentation matches the workflow.
- [ ] No catalog content or distribution route changes are included.

## STOP conditions

Stop if the generator check rewrites files outside the generated catalog outputs or if the existing CI lane cannot select the catalog source without broadening unrelated lanes.

## Maintenance notes

When the generator adds a new output surface, keep it in the same check. The check protects all generated copies, not only the desktop renderer.
