# Plan 018: Pin contract decoder edge behavior

> **Executor instructions**: Follow this plan step by step. If a STOP condition occurs, stop and report.
>
> **Drift check**: `git diff --stat 20d1cd63d9..HEAD -- packages/contracts scripts .github/workflows/ci.yml package.json`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `20d1cd63d9`, 2026-11-23

## Why this matters

The contracts package defines released Team API schemas and codecs used by preload, hosts, web, mobile, and the team client. It has no direct contract test files. A decoder change can therefore alter malformed-input handling, size limits, legacy compatibility, or unknown optional fields without a focused failure at the contract boundary.

## Current state

- `packages/contracts/src/team-protocol/v1.ts` contains the released v1 codec and message definitions.
- `packages/contracts/src/team-protocol/provider-aware-codec.ts` contains the provider-aware codec family.
- `packages/contracts/src/team-protocol/current.ts` defines current capability behavior.
- The repository has E2E scripts such as `scripts/team-protocol-v10-e2e.ts`, but `rg --files packages/contracts | rg '(test|spec)\\.(ts|tsx)$'` currently returns no contract-local tests.
- `packages/contracts/AGENTS.md` requires frozen codecs and fixtures for every supported protocol and says malformed known payloads must fail closed as `protocol_error`.

## Commands you will need

| Purpose | Command | Expected result |
|---|---|---|
| Contract typecheck | `bun run typecheck:contracts` | exit 0 |
| Protocol E2E | `bun run test:team-protocol-v10` | report passes |
| Legacy protocol E2E | `bun run test:team-legacy-clients` | report passes |
| Changed-file lint | `bunx biome check --max-diagnostics=none packages/contracts <new-test-file>` | exit 0 |

## Scope

**In scope**

- `packages/contracts` test or fixture files
- A focused `scripts/` E2E entry point if the existing runner is required to exercise released decoders
- Root `package.json` and CI registration for the narrow command

**Out of scope**

- Released codec semantics
- Raising the minimum protocol
- New capabilities or wire fields
- Renderer or mobile UI tests

## Steps

### Step 1: Inventory released decoder families

List the protocol versions and codec entry points used by preload, Team API, and team-client callers. Use existing fixtures under `packages/contracts/src/team-protocol/fixtures` as the source of released values.

**Verify**: `bun run typecheck:contracts` → exit 0.

### Step 2: Add edge-case fixtures

For each supported family, add cases for valid round trips, malformed known fields, oversized lists or payloads, legacy versions, unknown optional capability/event fields, and unsupported required fields. Assert the public decoder result or `protocol_error` mapping used by callers.

**Verify**: `bun run test:team-protocol-v10` and `bun run test:team-legacy-clients` → all steps pass.

### Step 3: Add a focused contract command

Expose one narrow command for the contract fixtures and select it in CI when `packages/contracts` or shared wire fixtures change. Keep existing E2E suites as compatibility checks.

**Verify**: `bunx biome check --max-diagnostics=none packages/contracts <new-test-file>` → exit 0.

## Test plan

Cover each released protocol in the support window, malformed known payload rejection, unknown optional field tolerance, capability list limits, round-trip encoding, and provider-aware open identifiers. Use fixture-driven assertions of decoded values and error codes.

## Done criteria

- [ ] Contract decoder edge behavior has direct repeatable coverage.
- [ ] Every supported released protocol remains represented.
- [ ] Malformed known input fails closed and unknown optional input stays compatible.
- [ ] Focused command, typecheck, lint, and existing protocol E2E checks pass.
- [ ] No wire contract or minimum-version change is included.

## STOP conditions

Stop if a fixture conflicts with a released schema or support-window rule. Stop if the intended assertion would require changing a decoder instead of recording its current released behavior.

## Maintenance notes

Add a fixture whenever a protocol field, capability limit, or decoder error mapping changes. Keep the fixture versioned with the codec and do not remove it while a supported release can send that shape.
