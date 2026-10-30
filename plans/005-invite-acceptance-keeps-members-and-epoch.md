# Plan 005: An invitation cannot disconnect a host or revive a removed member

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you start the
> next step. If a "STOP conditions" item occurs, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ac4880d86..HEAD -- apps/auth-api/src/server/remote-control-plane.ts apps/auth-api/scripts package.json`
> If `remote-control-plane.ts` changed, compare the "Current state" excerpts
> with the live code. On a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (account service, every team host)
- **Depends on**: none
- **Category**: security + bug
- **Planned at**: commit `ac4880d86`, 2026-10-17

## Maintainer decision (read first)

Step 3 needs one policy. The plan uses the default below. If the maintainer
chose another policy, use it and write it in the PR body.

| Who accepts | Default in this plan |
|-------------|----------------------|
| Active member (not owner) | Success. No write: the role, the auth epoch, the sessions and the invitation stay as they are. The answer gives the current role. |
| Member with `status = 'revoked'` | Refuse with the existing `404 invite_invalid`. Only an owner or admin can reactivate (`changeMembership` with `reactivate: true`). |
| No membership | No change from today. |
| Owner | No change from today (`409 owner_membership_protected`). |

## Why this matters

The account service (`apps/auth-api`, a Cloudflare Worker with D1) keeps host
memberships and invitations. Three defects are in invitation acceptance:

1. **Any re-accept disconnects the whole host.** When a user who already has a
   membership accepts an invitation, the batch adds 1 to `remote_hosts.auth_epoch`.
   Signal then closes every peer with a lower epoch, which includes the host and
   all other members (`remote/api/src/signal-service.ts`, `revoke(hostId, authEpoch)`).
   A member who opens a permanent link a second time disconnects everyone.
2. **A removed member comes back.** An admin removes a member with
   `changeMembership({ revoke: true })`, which sets `status = 'revoked'`. It does
   not revoke the permanent links. The removed user can open a permanent link
   that they still have, and the `ON CONFLICT ... DO UPDATE SET status = 'active'`
   makes them active again. Removal is not durable.
3. **The single-use invitation cap is not atomic.** `createInvite` counts the
   outstanding single-use invitations and inserts in a separate statement, so
   parallel requests can pass the cap of 50. The permanent path already does the
   count and insert in one statement.

The accept also rewrites the role of an active member to the role of the
invitation, so an admin who opens a member link becomes a member.

## Current state

- `apps/auth-api/src/server/remote-control-plane.ts` — `RemoteControlPlane`. The
  only file to change in the service.
  - Lines 61-64, the seat condition (binds: host, user, host, limit):
    ```ts
    const MEMBER_SEAT_AVAILABLE_SQL = `(
      EXISTS(SELECT 1 FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active')
      OR (SELECT COUNT(*) FROM remote_memberships WHERE host_id = ? AND status = 'active') < ?
    )`;
    ```
  - Lines 727-754, `createInvite`, single-use path: a `SELECT COUNT(*) AS count FROM remote_invites WHERE host_id = ? AND max_uses IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`, a check against `MAX_OUTSTANDING_INVITES_PER_HOST` (50) that returns `429 invite_limit_reached`, then a separate `INSERT INTO remote_invites(...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`.
  - Lines 689-724, the permanent path: one `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`, then `if ((created.meta.changes ?? 0) !== 1)` returns `429 invite_limit_reached`. This is the pattern for Step 4.
  - Lines 965-1090, `acceptInvite(user, token)`:
    ```ts
    const permanent = invite?.max_uses === null;
    if (!invite || invite.revoked_at || invite.expires_at <= now || (!permanent && invite.used_at)) {
      return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
    }
    // ... email check (403 invite_email_mismatch) ...
    const existingMembership = yield* remoteCall(() =>
      dependencies.database
        .prepare("SELECT role FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1")
        .bind(invite.host_id, user.id)
        .first<{ role: RemoteMemberRole }>(),
    );
    if (existingMembership?.role === "owner") { /* 409 owner_membership_protected */ }
    ```
    Then one `database.batch([...])` with six statements:
    - `[0]` `UPDATE remote_hosts SET auth_epoch = auth_epoch + 1 ... AND EXISTS(SELECT 1 FROM remote_memberships WHERE host_id = ? AND user_id = ?) AND ${MEMBER_SEAT_AVAILABLE_SQL}`. This adds 1 to the epoch when the user has a membership of **any** status.
    - `[1]` `this.#authEpochEventStatement(invite.host_id, now)`.
    - `[2]` `INSERT INTO remote_memberships ... ON CONFLICT(host_id, user_id) DO UPDATE SET role = CASE WHEN remote_memberships.role = 'owner' THEN 'owner' ELSE excluded.role END, status = 'active', updated_at = excluded.updated_at`.
    - `[3]` `use_count + 1` (permanent) or `used_at = ?` (single-use).
    - `[4]` `UPDATE remote_sessions SET ended_at = ? WHERE host_id = ? AND user_id = ? AND ended_at IS NULL`.
    - `[5]` the `account-servers-changed` event.
    After the batch, `(accepted[2]?.meta.changes ?? 0) !== 1 || (accepted[3]?.meta.changes ?? 0) !== 1` gives `409 invite_already_used`. The function returns `{ hostId, membershipId, role: invite.role }`.
  - Lines 1121-1220, `changeMembership`: `revoke` sets `status = 'revoked'`, adds 1 to the epoch, ends the sessions. It does not touch `remote_invites`.
- `packages/team-client/src/remote-directory.ts:110-119` — `DIRECTORY_ERROR_TEXT` maps service codes to localized text. `invite_invalid` is not in the map, so the client shows the service text, as it does today for an expired link. This plan adds no new error code, so this file does not change.
- Error convention: `return yield* new RemoteControlPlaneError(status, code, message)`. Keep the codes that exist. Clients depend on them.
- Test exemplar: `apps/auth-api/scripts/remote-auth-events-e2e.ts` (343 lines). It migrates an in-memory `node:sqlite` database from `apps/auth-api/migrations`, wraps it with `sqliteD1` from `apps/auth-api/scripts/sqlite-d1.ts`, makes an ECDSA P-256 key with `crypto.subtle.generateKey` and passes `REMOTE_TICKET_PRIVATE_JWK`, `REMOTE_TICKET_PUBLIC_JWKS` and `REMOTE_TICKET_KEY_ID` (lines 271-288), keeps `checks[]`, and writes `.openbot-build/remote-auth-events-e2e/report.json` (lines 338-343). The npm script is `"test:remote-auth-events": "bun apps/auth-api/scripts/remote-auth-events-e2e.ts"`, and `check:api` (package.json line 242) runs it in CI.
- `RemoteControlPlane` constructor (line 379): `new RemoteControlPlane(bindings, { fetch?, now?, schedule? })`. It throws `remote_not_configured` without the three ticket bindings. Without `REMOTE_AUTH_WEBHOOK_URL`, read the epoch and the queued events from the database, not from a fake Signal.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (fresh worktree only) | `bun install --frozen-lockfile` | exit 0 |
| New E2E | `bun run test:invite-acceptance` | exit 0, every line `PASS` |
| Existing E2E | `bun run test:remote-auth-events` | exit 0 |
| Account migration tests | `bun run test:api` | exit 0 |
| Typecheck | `bun run typecheck:api` | exit 0 |
| Lint changed files | `biome check --write --max-diagnostics=none <changed paths>` | exit 0 |

Do not run `bun run typecheck`, `bun run check:api`, builds or full suites. CI runs them.

## Scope

**In scope**:
- `apps/auth-api/src/server/remote-control-plane.ts` (`acceptInvite`, `createInvite` single-use path only)
- `apps/auth-api/scripts/invite-acceptance-e2e.ts` (create)
- `package.json` (add `test:invite-acceptance`, append it to `check:api`)
- `changelog.d/<branch>.md` (create; see `changelog.d/README.md`)

**Out of scope**:
- `changeMembership`, `revokeInvite`, and the Signal service in `remote/`. Their behavior is correct.
- `packages/team-client`, `packages/contracts`, `packages/i18n`. No new error code and no wire change.
- Migrations. No schema change is necessary. If you think one is, STOP.
- Revoking a member's permanent links on removal. The links are shared by many users; a revoked membership is blocked at acceptance instead.

## Git workflow

- Branch: `advisor/005-invite-acceptance`.
- Commit message style: one imperative sentence, for example `Keep members and the auth epoch when an invitation is accepted again`. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs checks. Never use `--no-verify`. Do not push or open a PR unless the operator tells you to.

## Steps

### Step 1: Write the E2E first, and see it fail

Create `apps/auth-api/scripts/invite-acceptance-e2e.ts`. Copy the structure of
`remote-auth-events-e2e.ts`: header comment, `checks[]`, `check()`,
`migratedDatabase()`, a list of scenario functions in try/catch, the report at
`.openbot-build/invite-acceptance-e2e/report.json`, and `process.exitCode = 1`
on a failure.

Setup for each scenario:
- A fresh migrated in-memory database. Insert one `remote_hosts` row and an
  owner `remote_memberships` row (`role = 'owner'`, `status = 'active'`). Copy
  the INSERT shape from `publishHost` in `scripts/mobile-connected-devices-e2e.ts:58-75`.
  Also insert the `users` rows that the foreign keys need (read
  `apps/auth-api/migrations` for the columns). If the member limit
  (`#memberLimit`) needs a plan row, insert what it reads.
- `const plane = new RemoteControlPlane({ DB: sqliteD1(database), REMOTE_TICKET_PRIVATE_JWK, REMOTE_TICKET_PUBLIC_JWKS, REMOTE_TICKET_KEY_ID }, { now: () => now })`.
- Run operations with `Effect.runPromise(Effect.either(plane.acceptInvite(user, token)))` or `Effect.result` (use the name that the installed Effect 4.0.0 exports; read `node_modules/effect`).
- Helpers: `epoch()` reads `SELECT auth_epoch FROM remote_hosts WHERE host_id = ?`; `membership(userId)` reads `role, status`; `openSessions(userId)` counts `remote_sessions` with `ended_at IS NULL`.

Scenarios (each one a function):
1. `aNewMemberJoins`: owner creates a permanent `member` link; user B accepts.
   Check: success, B is `member`/`active`, epoch unchanged, `use_count = 1`.
2. `aMemberAcceptsAgain`: after scenario 1, insert one open `remote_sessions` row
   for B (copy the columns from the migrations), then B accepts the same link again.
   Check: success, epoch unchanged, B's session still open, `use_count` still 1.
3. `anAdminKeepsTheRole`: B is `admin` (`changeMembership` by the owner with
   `role: "admin"`). B accepts a permanent `member` link. Check: success, role
   stays `admin`, the answer has `role: "admin"`, epoch unchanged by the accept.
4. `aRemovedMemberStaysRemoved`: owner revokes B (`changeMembership` with
   `revoke: true`). B accepts a live permanent link. Check: error code
   `invite_invalid`, B still `revoked`, epoch unchanged by the accept.
5. `aSingleUseLinkStaysUnusedForAMember`: B is active; owner creates a single-use
   link; B accepts. Check: success, `used_at` stays NULL.
6. `singleUseCapHolds`: insert 49 outstanding single-use invitations directly,
   then start 5 `plane.createInvite(owner, { hostId, role: "member" })` calls
   with `Promise.all`. Check: the count of outstanding single-use rows is 50,
   and 4 calls failed with `invite_limit_reached`.
   Note: `sqliteD1` on `node:sqlite` runs statements in order, so this
   scenario may pass before Step 4. Keep it as a regression check.

Add `"test:invite-acceptance": "bun apps/auth-api/scripts/invite-acceptance-e2e.ts"`
to the root `package.json`, next to `test:remote-auth-events`.

**Verify**: `bun run test:invite-acceptance` → exits 1. Scenarios 2, 3 and 4 print
`FAIL`. Scenario 1 prints `PASS`. If scenario 1 fails, fix the setup, not the service.

### Step 2: Read the existing membership with its status

In `acceptInvite`, change the membership read to
`SELECT membership_id, role, status FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1`
and type it as `{ membership_id: string; role: RemoteMemberRole; status: string }`.
Keep the owner check as it is.

**Verify**: `bun run typecheck:api` → exit 0.

### Step 3: Apply the policy before the batch

Directly after the owner check, add:

```ts
if (existingMembership?.status === "revoked") {
  return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
}
if (existingMembership?.status === "active") {
  return { hostId: invite.host_id, membershipId: existingMembership.membership_id, role: existingMembership.role };
}
```

Read the `status` values that the migrations and `changeMembership` write. If a
status other than `active` and `revoked` exists, STOP and report it.

After these two returns, a user who reaches the batch has no membership. So
statement `[0]` (the epoch update) and `[1]` (the epoch event) can no longer add
1. Remove both from the batch, and change the indexes in the success check from
`accepted[2]`/`accepted[3]` to `accepted[0]`/`accepted[1]`. Keep `[4]` (end the
user's sessions) and `[5]` (the event) in the batch.

The narrow race that remains: a membership row appears between the read and the
batch (a parallel accept by the same user). The `ON CONFLICT` keeps it correct.
Do not add more code for it.

**Verify**: `bun run test:invite-acceptance` → scenarios 1-5 `PASS`.
`bun run typecheck:api` → exit 0.

### Step 4: Make the single-use cap one statement

Replace the count + insert in the single-use path of `createInvite` with one
`INSERT INTO remote_invites(...) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, 0 WHERE (SELECT COUNT(*) FROM remote_invites WHERE host_id = ? AND max_uses IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?) < ?`,
in the same shape as the permanent path at lines 689-724. When
`created.meta.changes !== 1`, return the same error as today:
`429 invite_limit_reached` with "Revoke or use an active invitation before creating another one."

**Verify**: `bun run test:invite-acceptance` → all `PASS`.
`bun run test:remote-auth-events` → exit 0. `bun run test:api` → exit 0.

### Step 5: Wire CI and write the release note

Append `&& bun run test:invite-acceptance` to `check:api` in the root
`package.json`, after `test:remote-auth-events`. Create
`changelog.d/<branch>.md` in the format of `changelog.d/README.md`. Write one
user-facing sentence, for example: "Opening an invitation link again no longer
disconnects the server, and a removed member cannot rejoin with an old link."

**Verify**: `biome check --write --max-diagnostics=none apps/auth-api/src/server/remote-control-plane.ts apps/auth-api/scripts/invite-acceptance-e2e.ts package.json` → exit 0.

## Test plan

- One E2E script, `apps/auth-api/scripts/invite-acceptance-e2e.ts`, with the six
  scenarios of Step 1. It runs the real `RemoteControlPlane` on a migrated
  SQLite database and writes `.openbot-build/invite-acceptance-e2e/report.json`.
- Pattern: `apps/auth-api/scripts/remote-auth-events-e2e.ts`.
- No vitest file. This repository permits vitest only for migrations, the
  trust boundary, redaction and check-rule fixtures.

## Done criteria

- [ ] `bun run test:invite-acceptance` exits 0 and the report has `"passed": true`
- [ ] `bun run test:remote-auth-events` exits 0
- [ ] `bun run test:api` exits 0
- [ ] `bun run typecheck:api` exits 0
- [ ] `grep -n "auth_epoch = auth_epoch + 1" apps/auth-api/src/server/remote-control-plane.ts` has no line inside `acceptInvite`
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` state for 005 is updated

## STOP conditions

- The excerpts in "Current state" do not match the code.
- The maintainer chose a policy that needs a new error code. A new code needs an
  `@openbot/i18n` key and a `DIRECTORY_ERROR_TEXT` entry (read `docs/i18n.md`);
  report back for a scope change.
- A membership status other than `active` and `revoked` exists.
- Another caller depends on the epoch bump in `acceptInvite` (search
  `remote_auth_events` consumers and `remote-auth-changed` in `remote/` and
  `src/main`). Report the caller.
- The fix seems to need a migration.

## Maintenance notes

- Any future "upgrade role through an invitation" feature must go through
  `changeMembership`, which bumps the epoch on purpose.
- Reviewers: confirm the batch has no epoch statement and that the early return
  for an active member writes nothing.
- Deferred: a localized "you were removed from this server" message. It needs a
  new error code and catalog keys in all languages.
