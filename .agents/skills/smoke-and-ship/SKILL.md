---
name: smoke-and-ship
description: Smoke test the current branch, then ship it to main only when all smoke items pass. Use when the user asks to smoke and ship, or to test a change in the real app and then merge it.
---

# Smoke and ship

Run the `smoke` skill on the current branch. When all smoke items pass, run
the `ship` skill. Do not ship a branch with a failed smoke item.

When the user invokes this skill, they approve the merge at the end, but only
when the smoke test passes and every `ship` gate is green.

Keep a checklist in `TASKS.md`: one item for the smoke test, and one item for
each `ship` gate.

## Step 1 — Smoke

Run the `smoke` skill on the current branch. Do all of its steps and the
report. Keep the stack running until Step 2 ends: a retry needs it. Then do
the clean-up of the `smoke` skill.

## Step 2 — Decide

Use the smoke report:

- All items are `pass`: go to Step 3.
- The smoke skill says that the change has no user-visible behavior: this
  is a pass. Go to Step 3.
- One or more items are `fail`: do Step 2a for each failed item. When all
  of them pass after Step 2a, go to Step 3.
- An item is `not checked`:
  - When the cause is outside local reach (a real second computer, a paid
    provider, a production build, Windows or Linux), continue to Step 3.
    Put the item in the PR `## Verification` section.
  - For a different cause, such as a stack that did not start, stop and
    ask the user.

## Step 2a — Retry a flaky item

An item is flaky only when its evidence shows a cause outside the change:

- A `dev:automation` wait timed out while the UI showed a loading state or
  nothing. A wrong value, wrong text, or an app error message is not flaky.
- A CDP connection error, or a CDP port that moved after a start.
- A blank or halted renderer on the first start of a fresh profile.
- The stack, the test client, or a provider was not ready. The stack log
  shows it.
- A network timeout to a provider.

When there is no such evidence, the failure is real.

For a flaky item:

1. Reset the state that the failed attempt changed. Use a new chat or
   thread, reload the window, run `bun run dev:restart-client` for the test
   client, or stop your stack with `bun run dev:stop` and start it again with
   the same flags. Do not reuse data from the failed attempt.
2. Run the item again one time, with no code change.
3. When it passes, mark it `pass (flaky)`. Keep the evidence of the first
   failure.
4. When it fails again, the failure is real.

Retry each item one time only.

For a real failure: stop. Do not ship. Give the smoke report. Do not fix a
failure unless the user asks.

## Step 3 — Ship

Run the `ship` skill. Use the smoke result again:

- Do not run `smoke` again in Gate 1. For a UI change, use the screenshots
  from Step 1 when they show before and after. Take only the missing ones.
- Put the smoke table in the PR `## Verification` section. For each
  `pass (flaky)` item, add the evidence of the first failure.
- When a Gate 1 fix, a NorbiAI fix, or a CI fix changes user-visible
  behavior, smoke the affected items again before the push. When an item
  fails, use Step 2a.

## Report format

Give the smoke table from the `smoke` skill, with the final result of each
item after Step 2a. Then give the gate table from the `ship` skill. When you
stopped after the smoke test, give only the smoke report and the reason that
you did not ship.
