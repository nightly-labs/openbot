## Linked issue

<!-- `Closes #123`. A new feature or a change to how OpenBot works needs an issue with the `approved` label first: see https://github.com/nightly-labs/openbot/blob/main/CONTRIBUTING.md#what-you-can-send -->

## Type of change

- [ ] Bug fix
- [ ] Small improvement or alignment, with no change to how a feature works
- [ ] New provider, MCP app, or connector
- [ ] Translation or documentation
- [ ] New feature or change to existing behavior (needs an approved issue)

## What changed

<!-- Describe the user-visible outcome and why this is the smallest useful change. -->

## Verification

- [ ] Narrow checks for what changed: `biome check <paths>`, a targeted `tsc`, and the affected test files — CI owns the full suite
- [ ] Surfaces touched are named under "What changed": renderer, mobile, `apps/auth-api`, the three `--openbot-*` palettes, IPC contracts and `mock-openbot.ts`, reverse states, migrations and the latest schema, documentation
- [ ] A feature for agents, chats, channels, routines or server settings also works on a joined server (desktop, `openbot.run/app`, mobile when it fits a phone), or "What changed" says why it is local only
- [ ] Relevant manual smoke test completed, or not applicable
- [ ] No credentials, private data, generated output, or real user files are included

## Failure modes

<!-- Remove this section unless the PR adds or changes a vitest file. Write the list before the code: one line per way the system can fail, with the test that covers it. -->

- 

## Risk and security impact

<!-- Note changes to permissions, IPC, filesystem access, persistence, browser behavior, or network access. Write "None" when not applicable. -->

## Screenshots

<!-- Include before/after screenshots for visual changes. Remove this section when not applicable. -->

## Approvability

<!-- Remove this section unless the PR adds a `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, a rule-disabling `biome.json` override, or a widening to `any`/`unknown` or a type assertion at a boundary. Otherwise name the reason each one is there. -->
