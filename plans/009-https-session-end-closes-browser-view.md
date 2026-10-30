# Plan 009: An HTTPS sign-out or session revoke also closes the browser views of that session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before you start the
> next step. If a "STOP conditions" item occurs, stop and report. Do not
> improvise. When done, set the state of this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ac4880d86..HEAD -- src/main/team-api/route-team.ts src/main/team-api-server.ts src/main/host-service.ts src/main/browser-view-gateway.ts src/main/team-api/dependencies.ts`
> If a file changed, compare the "Current state" excerpts with the live code.
> On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 002 can remove local password sign-in later; this route stays for other sessions)
- **Category**: security
- **Planned at**: commit `ac4880d86`, 2026-10-17

## Why this matters

A team member can open a live view of a host browser tab
(`BrowserViewGateway`, `src/main/browser-view-gateway.ts`). The gateway checks
the member's token only when the WebSocket opens (`#authorized`, line 257).
After that, frames and input flow until something calls
`revokeTeamSession(teamSessionId)` or `closeMemberSession`.

Every host path that ends a session calls it — except the two HTTPS routes in
`src/main/team-api/route-team.ts`:

- `POST /v1/auth/logout` calls `store.logout` and `remoteScreen.revokeTeamSession`.
- `DELETE /v1/team/sessions/:id` (an admin ends a session) calls
  `store.revokeSession`, `onSessionRevoked` and `remoteScreen.revokeTeamSession`.

So after a member signs out over HTTPS, or an admin ends their session from a
web or phone client, an already open browser view keeps showing the host
browser and keeps accepting input. The desktop path
(`HostService.revokeSession`) and member removal (`#closeLocalSession`) do
close it. This plan makes the two HTTPS routes do the same.

## Current state

- `src/main/team-api/route-team.ts`:
  - Lines 21-41, `TeamRouteDependencies`; line 36:
    `remoteScreen?: Pick<TeamApiRemoteScreen, "revokeTeamSession" | "revokeMember">;`
    There is no `browserView` field.
  - Lines 45-56, the destructured dependencies of `routeTeam`.
  - Lines 81-86:
    ```ts
    if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.logout) {
      await runCauseEffect(store.logout(token));
      await (remoteScreen ? runCauseEffect(remoteScreen.revokeTeamSession(sessionId)) : undefined);
      refreshPresence();
      return empty(204);
    }
    ```
  - Lines 200-213 (DELETE session):
    ```ts
    await runCauseEffect(store.revokeSession(revokedSessionId));
    await (onSessionRevoked ? runCauseEffect(onSessionRevoked(revokedSessionId)) : undefined);
    await (remoteScreen ? runCauseEffect(remoteScreen.revokeTeamSession(revokedSessionId)) : undefined);
    refreshPresence();
    return empty(204);
    ```
- `src/main/team-api-server.ts:861-872`, `#routeTeam`: passes `store`,
  `remoteScreen`, `createInvite`, `updateMember`, `removeMember`,
  `onSessionRevoked`, `getPresence`, `refreshPresence`. Line 894 shows that
  `this.#options.browserView` exists (it is passed to `routeBrowser`).
- `src/main/team-api/dependencies.ts:311-314`:
  ```ts
  export type TeamApiBrowserView = Pick<
    BrowserViewGateway,
    "handlesUpgrade" | "handleUpgrade" | "stop" | "createSession" | "closeMemberSession" | "revokeTeamSession"
  >;
  ```
- `src/main/browser-view-gateway.ts:193-203`, `revokeTeamSession(teamSessionId)`:
  closes each view session whose `teamSessionId` matches, with the reason
  "Team access ended.". It returns `Effect<void, RemoteWorkflowError>` (the
  `BrowserViewPort` requirement is provided inside).
- The paths that already close browser views, for comparison:
  - `src/main/host-service.ts:1170-1178`, `HostService.revokeSession`:
    `#revokeWebRtcSession`, `store.revokeSession`, `remoteScreen.revokeTeamSession`, `browserView.revokeTeamSession`.
  - `src/main/host-service.ts:1214-1223`, `#closeLocalSession`: also `browserView.revokeTeamSession`.
  - `src/main/host-service.ts:429-435`, the WebRTC `closeSession` callback: also `browserView.revokeTeamSession`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install (fresh worktree only) | `bun install --frozen-lockfile` | exit 0 |
| New E2E | `bun scripts/team-session-end-e2e.ts` | `PASS`, exit 0 |
| Related tests | `bun run test:related -- src/main/team-api/route-team.ts` | exit 0 |
| Typecheck | `bun run typecheck:node` | exit 0 |
| Lint changed files | `biome check --write --max-diagnostics=none src/main/team-api/route-team.ts src/main/team-api-server.ts scripts/team-session-end-e2e.ts` | exit 0 |

Do not run `bun run typecheck`, builds or full suites.

## Scope

**In scope**:
- `src/main/team-api/route-team.ts`
- `src/main/team-api-server.ts` (only `#routeTeam`)
- `scripts/team-session-end-e2e.ts` (create)
- `changelog.d/<branch>.md` (create)

**Out of scope**:
- `browser-view-gateway.ts`. Do not add a per-message token check in this plan.
- `host-service.ts`, `team-store.ts` (plan 002 owns local password sign-in).
- Push notification and Live Activity registrations on HTTPS logout (see
  "Maintenance notes"; not confirmed).
- Any Team API wire shape, status code or error code. Both routes still answer 204.
- `packages/contracts`.

## Git workflow

- Branch: `advisor/009-session-end-closes-browser-view`.
- Commit message: one imperative sentence, for example `Close browser views when a session ends over HTTPS`.
  End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs checks. Never use `--no-verify`. Do not push or open a PR unless told to.

## Steps

### Step 1: Write the E2E (it fails first)

Create `scripts/team-session-end-e2e.ts`. Header comment: what it proves and
`Run: bun scripts/team-session-end-e2e.ts`. Follow the shape of
`scripts/mailbox-queue-scale-e2e.ts` (a `report` object, `try/finally`, write
`.openbot-build/team-session-end-e2e/report.json`, `process.exitCode = 1` on failure).

The script calls the real `routeTeam` from `src/main/team-api/route-team.ts`
with recording stand-ins:

- `store`: an object with `logout`, `revokeSession`, `listSessions` and
  `listMembers` (and the other names of the `Pick` that the type needs, each
  returning `Effect.die("unused")` or an empty value). `logout` and
  `revokeSession` return `Effect.void` and record their argument.
  `listSessions()` returns one session `{ id: "session-b", memberId: "member-b", ... }`
  (read the session summary type that `TeamStore.listSessions` returns, and fill
  the required fields). `listMembers()` returns an owner `member-a` and a member `member-b`.
- `remoteScreen`: `revokeTeamSession` and `revokeMember` record and return `Effect.void`.
- `browserView`: `revokeTeamSession` records and returns `Effect.void`.
- `refreshPresence`, `getPresence`: no-ops.
- The context: build real `IncomingMessage`/`ServerResponse` objects
  (`new IncomingMessage(new Socket())`, `new ServerResponse(request)`), `url`
  from `TEAM_API_ROUTES`, `member` an owner `TeamMemberSummary`, `token`,
  `sessionId: "session-a"`, and `json`/`empty` that record the status and return `"handled"`.
  Do not use type assertions (`as`) to skip fields.

Scenarios:
1. `POST TEAM_API_ROUTES.auth.logout` → status 204, `store.logout` got the
   token, `remoteScreen.revokeTeamSession` got `session-a`,
   **`browserView.revokeTeamSession` got `session-a`**.
2. `DELETE /v1/team/sessions/session-b` as the owner → status 204,
   `store.revokeSession`, `remoteScreen.revokeTeamSession` and
   **`browserView.revokeTeamSession`** each got `session-b`.
3. The same DELETE with no `browserView` dependency → still 204 (the field is optional).

Pass `browserView` in the dependency object now; before Step 2 TypeScript may
reject the unknown field. If so, build the dependencies as a separate variable
typed with `Parameters<typeof routeTeam>[1]` widened by `& { browserView?: unknown }`
only for the first run, and remove that after Step 2.

**Verify**: `bun scripts/team-session-end-e2e.ts` → exits 1, and only the
`browserView` checks of scenarios 1 and 2 fail. If the import of `route-team.ts`
fails because it loads Electron, STOP and report.

### Step 2: Close browser views on both routes

1. In `route-team.ts`, import `TeamApiBrowserView` beside `TeamApiRemoteScreen`
   and add to `TeamRouteDependencies`:
   `browserView?: Pick<TeamApiBrowserView, "revokeTeamSession">;`
   Add `browserView` to the destructured dependencies of `routeTeam`.
2. In the logout route, after the `remoteScreen` line:
   `await (browserView ? runCauseEffect(browserView.revokeTeamSession(sessionId)) : undefined);`
3. In the DELETE session route, after the `remoteScreen` line:
   `await (browserView ? runCauseEffect(browserView.revokeTeamSession(revokedSessionId)) : undefined);`
4. In `team-api-server.ts` `#routeTeam`, add `browserView: this.#options.browserView,`.
5. Remove the temporary type widening from the E2E, if you added it.

**Verify**:
- `bun run typecheck:node` → exit 0.
- `bun scripts/team-session-end-e2e.ts` → `PASS`, exit 0.
- `bun run test:related -- src/main/team-api/route-team.ts` → exit 0.

### Step 3: Lint and release note

`biome check --write --max-diagnostics=none src/main/team-api/route-team.ts src/main/team-api-server.ts scripts/team-session-end-e2e.ts` → exit 0.
Create `changelog.d/<branch>.md` with one `### Fixed` item, for example:
"Signing out, or ending a session from a phone or the web, now also closes that session's live browser view."

## Test plan

- `scripts/team-session-end-e2e.ts` runs the real `routeTeam` handler and checks
  which session parts each route closes. It writes a JSON report.
- No Vitest file. This is the Team API route layer, not the renderer-to-main
  trust boundary that `AGENTS.md` protects with Vitest.

## Done criteria

- [ ] `bun scripts/team-session-end-e2e.ts` exits 0 and the report has `"passed": true`
- [ ] `bun run typecheck:node` exits 0
- [ ] `grep -n "browserView.revokeTeamSession" src/main/team-api/route-team.ts` shows 2 lines
- [ ] `grep -n "browserView: this.#options.browserView" src/main/team-api-server.ts` shows the `#routeTeam` line
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` state for 009 is updated

## STOP conditions

- The excerpts do not match the code (for example, the routes already call one
  host "close session" hook).
- `BrowserViewGateway.revokeTeamSession` no longer exists or its error type is
  not `RemoteWorkflowError`.
- Importing `route-team.ts` in a plain Bun script fails.

## Maintenance notes

- Each new per-session resource on the host (views, streams, push
  registrations) must be closed on all five paths: `HostService.revokeSession`,
  `#closeLocalSession`, the WebRTC `closeSession` callback, and the two HTTPS
  routes. A later change can route the HTTPS paths through one host hook.
- **Not confirmed**: the HTTPS logout route also does not call
  `onSessionRevoked`, so `pushNotifications.remove(sessionId)` and
  `liveActivityPush.remove(sessionId)` do not run on logout. I looked at
  `route-team.ts:81-86`, `host-service.ts:392` and `push-notifications.ts:95-152`.
  I did not confirm whether the account service stops pushes for that session.
  Report it as a follow-up; do not change it here.
