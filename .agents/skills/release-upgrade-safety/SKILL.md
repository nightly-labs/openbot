---
name: release-upgrade-safety
description: Audit a pending OpenBot release for upgrade and data-loss hazards before the version is bumped or tagged. Use when asked to cut a release, create or bump a version, prepare a tag, or check whether a change is safe to ship to installed users.
---

# Release upgrade safety

Every hazard here is one an installed user pays for and you cannot take back. `openbot.db` is
migrated in place with no backup, two dozen files under `userData` are rewritten by whichever build
opens them last, a released Team API adapter is spoken by peers you will never update, and the
account Worker's D1 migrations are applied before the Worker that needs them. A build that ships
past one of these does not fail on your machine; it fails on someone else's, once, permanently.

Audit the diff since the last released tag against the seven gates below, then report a verdict.
This runs *before* `docs/RELEASING.md`, which stays authoritative for the publish itself.

## What this skill does and does not do

- It audits. It does not run `bun run release:patch`, commit a version bump, or push a tag unless
  you are separately asked to.
- It never runs `bun run check`, `check:desktop`, `test`, or `build-storybook` — each takes minutes,
  CI owns them, and the desktop suite flakes under load, so a red result would tell you nothing.
  Run the narrowest test file named by a gate, then `bun run lint` and `bun run typecheck`.
- **If gate C or D fired, add `bun run mobile:typecheck`.** `bun run typecheck` is `typecheck:*` and
  the mobile script is named `mobile:typecheck`, so the aggregate misses it — and `apps/mobile`
  depends on `@openbot/contracts`, which is exactly what those two gates change. A contract export
  change passes the aggregate and still breaks the mobile app.
- It never runs `bun run dev:seed` or `dev:reset` — both destroy the developer's own profile — and
  never `pkill -f`, which kills other sessions' work mid-write.

## Step 1 — establish the range, then account for every file in it

```bash
git status --porcelain
git tag --list 'v*' --sort=-v:refname | head -1
git diff --name-status <tag>..HEAD
```

**Stop if the tree is not clean.** The audit is over the commit range, not the working tree, and
that is only sound if the working tree is empty — otherwise the range you audit and the range that
ships are different sets. Nothing upstream of you enforces this: `scripts/prepare-release.ts` writes
the version bump without looking at `git status`, and its closing instruction is "Review, commit,
push, run preflight, then tag it", so following it sweeps whatever was uncommitted into the release.
`scripts/release-preflight.ts` does check `git status --porcelain`, but it runs *after* that commit,
by which point the tree is clean and the unaudited work is inside the tag. Commit or stash first.

State the tag and the changed-file count up front, and run every gate's `git diff` over that same
range. A hazard three commits back is in scope; the file you have open is not, unless it is
committed.

**The outcome Step 1 owes Step 3: every changed file is either routed to a gate, or dismissed for a
reason you can state.** A release here runs to hundreds of files — the range audited when this skill
was written was 942 — so group them however makes the residue small, and record in the Step 3 table
how each group was cleared. The failure this skill exists to prevent is almost never a hazard that
was examined and misjudged. It is one that was never looked at, because nothing pointed at it. If
the residue you cannot account for is large, that is itself the finding: report the count rather
than writing a dismissal you did not earn.

**The diff drives the audit, not the trigger lists.** Each gate names the paths that obviously
belong to it. Treat those as a starting point and never as the authority: they are written by hand,
they go stale, and a release can touch a file nobody thought to list. The question a gate actually
asks is "does this file carry the hazard I own", and only the file in front of you answers that.

Four things look dismissible and are not. Note what the last three have in common: **nothing this
audit delegates a check to can be dismissed by the bucket its file lives in.**

- **`src/renderer/**`** — the renderer writes `localStorage`, that store lives in the user's
  Electron partition, and it outlives the build that wrote it exactly the way a file under
  `userData` does. Route it through gate B.
- **The tests a gate relies on.** "Not in the shipped app" is true of every test and irrelevant for
  these, because a gate that delegates its check to a test inherits that test's weakening.
  `openbot-database-schema-parity.test.ts` is the whole mechanical half of gate A's DDL rule;
  `openbot-database.test.ts` carries the downgrade guard; `ipc-channel-coverage.test.ts` is gate D's
  only static link between main and preload; `electron-updater-assumptions.test.ts` pins the updater
  behaviour gate F rests on; the `v*.test.ts` files are gate C's. A change that makes one of those
  assertions vacuous passes every later gate, and once it is tagged the weakening is behind the
  range every future audit starts from. Route a modification or deletion of one through the gate
  that names it and read the hunks. Other `**/*.test.ts` files dismiss normally.
- **`docs/RELEASING.md`**, for the same reason one level up. This audit does not restate the Team
  API compatibility matrix — gate C points at preflight item 0 and stops there — and it hands the
  publish itself back to that document at Step 3. Weakening either is invisible to every gate here,
  because the gate's own text still reads correctly while the thing it defers to no longer says what
  it assumed. Read its changed hunks under gate C and the handoff.
- **A directory cleared by a derived query**, such as gate B's `git grep` over `src/main` and
  `src/backend`. It inherits that gate's obligation: if the query returns nothing, the pattern is
  broken, not the directory clean.

The rest of `docs/**`, `tools/**` and `src/renderer/stories/**` are not in the shipped app at all,
which is a reason that covers every file in them. "Nothing looked interesting" is not.

## Step 2 — the seven gates

Work through all seven. A gate no path triggered is reported as **not triggered** — never dropped
silently, because "I did not look" and "I looked and it was clean" are different verdicts and only
one of them is a release gate.

Load a gate's reference when its trigger fires, not before:

| Gate | Triggered by | Reference |
| --- | --- | --- |
| A. SQLite schema | `src/backend/openbot-database-schema.ts`, `src/backend/database/` | [gate-a-sqlite.md](references/gate-a-sqlite.md) |
| B. On-disk state outside SQLite | any decoder of a versioned file, and `src/renderer/**` for `localStorage` | [gate-b-on-disk-state.md](references/gate-b-on-disk-state.md) |
| C. Team API wire | `packages/contracts/src/team-protocol/`, `docs/RELEASING.md` | [gate-c-team-api.md](references/gate-c-team-api.md) |
| D. IPC channels | `packages/contracts/src/ipc-channels.ts` and its mirrors | [gate-d-ipc.md](references/gate-d-ipc.md) |
| E. Account Worker | `apps/auth-api/` | [gate-e-account-worker.md](references/gate-e-account-worker.md) |
| F. The updater itself | `electron-builder.yml`, `src/main/update-service.ts`, `package.json` | [gate-f-updater.md](references/gate-f-updater.md) |
| G. Reverse states and the changelog | always triggered | [gate-g-reverse-states.md](references/gate-g-reverse-states.md) |

`references/surfaces.md` holds the exhaustive path inventory. Load it when a gate fires and you
need the exact file, not before.

**Some checks in those gates pass by producing no output. Prove the command can still speak before
you trust its silence** — run it over a range you know contains a hit, or confirm a list you expect
to be long is not empty. An empty result means "nothing is wrong" and "I asked the wrong question"
equally well, and the second is the more common of the two. This is not hypothetical: it is how
`check:ui` lost two checks (`AGENTS.md`, Tests) and why the repo deleted `no-runtime-typeof`.

## Step 3 — report and hand off

Report a table:

| Gate | Triggered by | Verdict |
| --- | --- | --- |
| A. SQLite schema | *path, or "not triggered"* | pass / stop / needs a human |

Then state the stops explicitly. Any one of these means **the version is not cuttable yet**:

- a frozen Team API codec, adapter or fixture that was deleted, renamed, or modified **in a way
  that can change what an encoded payload means** — the narrow exception gate C allows, a hunk that
  provably cannot alter the wire, is not a stop, and gate C is where that call gets made;
- a DDL migration not mirrored into `LATEST_SCHEMA_SQL`;
- a renamed on-disk file, or a bumped stored `version`, with no read path for the old one;
- a D1 contraction without the two-step release;
- a changed `appId`, `ElectronTeamID`, or `publish` target.

If every gate passes, say so and hand off: `docs/RELEASING.md` owns the publish — the preflight
checklist, the compatibility matrix, signing, notarization, the canary update and the size gates.
