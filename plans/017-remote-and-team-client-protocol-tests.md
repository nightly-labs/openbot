# Plan 017: Add direct remote protocol coverage

> **Executor instructions**: Follow this plan step by step. If a STOP condition occurs, stop and report.
>
> **Drift check**: `git diff --stat 20d1cd63d9..HEAD -- remote/api packages/team-client scripts package.json .github/workflows/ci.yml`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `20d1cd63d9`, 2026-11-23

## Why this matters

The Remote API and team client carry authentication, framing, reconnect, relay, and external-platform traffic. Their packages expose typecheck and runtime checks, but no package-local test files. Desktop E2E coverage can miss a standalone Signal deployment or a client-side decoder regression.

## Current state

- `remote/api/package.json` exposes `dev`, `start`, `typecheck`, and `check`, with no test script.
- `packages/team-client/package.json` exposes typecheck but no test script.
- `remote/api/src/app.ts` and `remote/api/src/discord-gateway.ts` contain HTTP/WebSocket and gateway behavior.
- Existing real E2E entry points are `scripts/signal-security-e2e.ts` and `scripts/team-api-routes-e2e.ts`, with root scripts `test:signal` and `test:team-api-routes`.
- `remote/api/AGENTS.md` requires real HTTP/WebSocket security checks and says CI runs `bun run test:signal` when `remote/` changes.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Signal E2E | `bun run test:signal` | report passes and artifact is written |
| Team API E2E | `bun run test:team-api-routes` | report passes and artifact is written |
| Remote typecheck | `bun run typecheck:remote` | exit 0 |
| Team client typecheck | `bun run typecheck:team-client` | exit 0 |

## Scope

**In scope**

- `remote/api` test harness or a focused `scripts/` E2E script
- `packages/team-client` test harness or a focused `scripts/` E2E script
- Root `package.json` scripts needed to run the focused checks
- `.github/workflows/ci.yml` only if a new narrow lane is required

**Out of scope**

- Protocol behavior changes
- New providers or external integrations
- Network calls to real third-party accounts
- Replacing the existing security E2E suite

## Steps

### Step 1: Map existing seams

Read the Signal app startup and team-client transport entry points. Reuse throwaway keys, local servers, and fixture helpers from the existing E2E scripts. Keep tests isolated from production credentials and external services.

**Verify**: `bun run test:signal` and `bun run test:team-api-routes` → current suites pass before new coverage.

### Step 2: Add focused protocol scenarios

Cover remote HTTP authentication and rejection, WebSocket reconnect and close behavior, ingress queue ordering and retry limits, relay/credential bounds, and team-client request/response decoding with malformed and unknown optional fields. Use real local servers and injected transports where the package boundary permits.

**Verify**: the new focused command writes a JSON report under `.openbot-build/` and exits 0.

### Step 3: Register narrow checks

Add package or root scripts that run the scenarios without the full desktop app. Add them to CI only in the lane that already selects `remote/` or `packages/team-client` changes.

**Verify**: `bun run typecheck:remote` and `bun run typecheck:team-client` → exit 0.

## Test plan

Assert authentication, framing, reconnect, queue order, limit enforcement, and safe error mapping. Include malformed payloads, connection close during a request, duplicate delivery, and unknown optional event fields. Do not assert internal implementation calls.

## Done criteria

- [ ] Remote API and team-client critical protocol paths have direct repeatable tests.
- [ ] Tests use local or injected boundaries and no production secrets.
- [ ] Focused commands write verifiable artifacts.
- [ ] CI runs the narrow checks for affected changes.
- [ ] Existing Signal and Team API E2E suites still pass.

## STOP conditions

Stop if a proposed test requires a real Slack, Discord, Telegram, TURN, or hosted account. Stop if adding a package test runner duplicates an existing repository runner without a clear isolated command.

## Maintenance notes

Keep protocol fixtures aligned with the support window. When a released wire version changes, update the fixture and both directions of the compatibility tests in the same change.
