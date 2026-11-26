---
name: release-mobile-ota
description: Deliver an over-the-air (OTA) update of the OpenBot mobile app with caution. Audit the commits since the store builds, write and merge the release notes so the update banner shows the changes, dry-run, publish, and check the live update server. Use when asked to ship, publish, release or deliver a mobile OTA update, or to send main to the phones without a store build.
---

# Release a mobile OTA update

An OTA update sends a new JavaScript bundle to the phones of a store build, through
`apps/mobile-updates` at `https://updates.openbot.run`. There is no store review. A bad update
reaches each phone at its next cold start. Read
[the OTA section of the mobile README](../../../apps/mobile/README.md#over-the-air-updates) first.

When the user invokes this skill, they approve these actions, but only when each gate before them
is green:

- the merge of the release notes PR, which deploys the account service;
- the publish of the update.

Stop and ask when a gate fails, when a step needs a product decision, a force-push or a bypass, and
before a rollback.

## Rules from earlier releases

- **Notes first, then publish.** The "Quick update ready" banner reads the `x.y.z.n` section from
  the account service (`/v1/mobile/changelog`) when the update is ready on the phone. After the
  restart, the banner is gone. A phone that gets the update before the notes deploy never shows
  the changes.
- **The running bundle draws the banner.** The phone shows the banner of the bundle that it runs
  now, not the banner of the update. Before you say what users will see, check which bundle has
  the banner code.
- **Rollout.** Use the percentage that the user gives. With no percentage, publish to 100%. Do not
  choose a smaller rollout yourself: a phone outside the rollout gets no update at any cold start,
  because its bucket is fixed per install and update (`apps/mobile-updates/src/index.ts`).
- **`mobile:ota:status` does not see a partial rollout.** It asks with no install ID, so under 100%
  it shows the earlier update or "no update". Use `scripts/probe-update.ts` in this folder.
- Do not change `updates.url`, the certificate or the key ID.

## Step 0 — prepare

1. Keep a checklist in `TASKS.md` with one item per step.
2. `git fetch origin main --tags`. Work from a clean tree. `git status --short` must be empty.
3. In a fresh worktree, run `bun install --frozen-lockfile`.

## Step 1 — find the store builds and the state of the server

```bash
bun run mobile:ota:check
bun run mobile:ota:status
git tag -l 'mobile-build/*' --sort=-creatordate | head -6
```

- `check` names the store builds that can get `origin/main`. When it says that the checkout needs a
  store build, `main` has a native change. Follow the hotfix steps in the README
  (`mobile-hotfix/<version>` branch) and ask the user which fix to pick.
- Read the store state in `apps/mobile/CHANGELOG.md`. Publish only to a platform whose store has
  the version (a date, not "In review").
- Record each base tag `mobile-build/<platform>/<version>/<build>/<runtime>`, and the update that
  `status` shows for it now. A rollback goes back to that update.

## Step 2 — audit the range

Set `B` to the base tag. When iOS and Android have different base commits, audit each range.

```bash
git log --format='%h %s' $B..origin/main -- apps/mobile/src
git diff --stat $B origin/main -- apps/mobile packages
```

Check each item. Write the evidence for each one in the report.

1. **Rollback data.** A rollback runs the bundle of the binary with the data that the update wrote.
   Search the added lines for new or changed stored data:
   `git diff $B origin/main -- apps/mobile/src packages | grep -E '^\+' | grep -nE 'SecureStore|setItemAsync|AsyncStorage|FileSystem|new File\(|\.write\(|MMKV|schemaVersion|CACHE_VERSION'`.
   A new key that the old bundle ignores is safe. A changed format of an existing key, file or
   workspace copy is a stop.
2. **Native modules.** List the package imports that the range adds to `apps/mobile/src`. Each one
   must already be imported at `$B` (`git grep -l 'from "<package>' $B -- apps/mobile/src`) or be
   pure JavaScript. New code that needs a native module must check that the module is there.
3. **Hosts in the support window.** For each commit that calls the host, the phone must work with
   the host releases that are out now. A new route or field must be gated on a host capability,
   and with no capability the phone must act as before. Notes that say "The server must be on the
   new version" with no phone code in the range are host fixes: the update does not deliver them.
4. **Notes.** Each user-visible change in the range has a note file in `apps/mobile/changelog.d`.

Use a subagent per area when the range is large. Check the evidence in each report.

## Step 3 — write and merge the release notes

1. Make a branch from `origin/main`, such as `t3/mobile-ota-<version>.<n>`.
2. `bun run mobile:release:ota -- --base <base tag> --platform <platforms>`. Review the new
   `## [<version>.<n>]` section in `apps/mobile/CHANGELOG.md`.
3. Commit `apps/mobile/CHANGELOG.md` and `apps/mobile/changelog.d`. Do not use `--no-verify`.
4. Open the PR from `.github/PULL_REQUEST_TEMPLATE.md`. Name the base tag and the store builds.
5. Take the PR through the NorbiAI review and CI as the `ship` skill says (gates 3 to 5). Merge
   only when every check is green, with
   `gh pr merge <pr> --squash --match-head-commit <head sha>`.
6. Wait for the `Deploy Cloudflare production` job of the `CI` run of the merge commit on `main`.
   It must succeed.
7. Confirm that the notes are live, for each platform:

   ```bash
   curl -s "https://openbot.run/v1/mobile/changelog?platform=ios&after=<store version>" | jq '.releases[].version'
   ```

   The new version must be in the list.
8. `git fetch origin main`. When `main` has new mobile code or new files in
   `apps/mobile/changelog.d` since the commit of the notes, go back to Step 2 for that range.

## Step 4 — dry run

The publish runs `.github/workflows/mobile-ota.yml` on the remote branch. The script requires the
checked-out branch to be `main` or `mobile-hotfix/*`, at the commit of `origin`:

```bash
bun run mobile:ota:publish -- --platform all --message "<what the update does>" --dry-run
```

In a worktree on another branch, with `HEAD` at `origin/main`, start the same workflow:

```bash
gh workflow run mobile-ota.yml --ref main -f action=publish -f platform=all -f channel=production \
  -f "message=<what the update does>" -f rollout=100 -f dry_run=true
```

Wait for the run. It must succeed, and its log must say that the guard passed and name the store
builds of Step 1. A dry run does not run `expo export`.

## Step 5 — publish

Run the same command without `--dry-run` (or with `-f dry_run=false`), with the rollout of the
user. Wait for the run. Its summary names one update ID per platform. Record them.

## Step 6 — check the live server

Wait 30 seconds for the server cache. For each platform:

```bash
bun .agents/skills/release-mobile-ota/scripts/probe-update.ts \
  --platform <ios|android> --runtime <runtime version> --update <update ID> --rollout <percentage>
```

The script asks the server as a phone inside the rollout and, under 100%, as one outside it. It
downloads each asset. It exits 0 only when the phone inside gets the signed update, the phone
outside does not, and all assets download. At 100%, `bun run mobile:ota:status` must also name
the update ID.

## Step 7 — report

Give one table: platform, store build, update ID, rollout, probe result. Say which checks ran and
which did not, for example that no real phone installed the update. Give the commands for the
next actions:

- `bun run mobile:ota:rollout -- --platform all --rollout <percentage>`
- `bun run mobile:ota:rollback -- --platform all`

Do not start a rollout change or a rollback without a request from the user.
