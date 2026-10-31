---
name: "Acceptance Check"
description: "Test a live web app against an acceptance checklist in a real browser and return PASS, FAIL or BLOCKED with screenshots and repro steps. Use before a release, after a deploy, or for a scheduled smoke check of a saved site."
---

# Acceptance Check

## When to use

- Before a release or after a deploy, to decide whether a change can ship.
- For a standing smoke check of a saved site address.
- Not for code review or root-cause work. Use Change Review or Bug Triage for those.

## Inputs

1. **Site address.** From the user, the pull request, the deploy message, or the saved target.
2. **Checklist.** From the user, the issue or pull request (read it with `gh` or an installed plugin such as
   Linear), or a scope document. If there is none, write 3 to 8 items from the stated change: the main
   path first, then one edge case, one error state and one item that must not have changed. Ask the user
   to confirm the list once with `ask_user`.
3. **Test account.** Use the test account the user gives. Never use a real customer account. If a step needs a
   verification code, ask the user for it. Read it from a signed-in inbox tab only when the user said you may.

For a routine, read the saved target from the shared data table `qa_targets` (site address, checklist, test
account name, last result). Create the table on the first save. Never store passwords in it.

## Steps

1. Call `openbot_browser.list_tabs`. Open a new tab for the test. Do not reuse a tab with a real session.
2. Load the address. Record the final address after redirects, the page title and the time.
3. For each checklist item, act as a user: click, type, submit. Do not call page scripts to skip steps.
4. After each item, take one screenshot that shows the result. Name it `<item number>-<short name>.png`.
5. Mark the item PASS, FAIL or BLOCKED (see the rubric). Write one line of evidence: the visible text, the
   value, or the error shown.
6. For each FAIL, write numbered repro steps from a fresh tab, the expected result, the actual result, and any
   console error or failed request that the browser shows. Retry the item once to separate a real failure
   from a slow load. Report a result that changes between tries as FLAKY inside the FAIL line.
7. Compute the verdict. Save the result and the time to `qa_targets` for a saved target.

## Rubric

- **PASS:** the item did what the checklist says, and the screenshot shows it.
- **FAIL:** the item ran and the result is wrong, missing, or shows an error.
- **BLOCKED:** you could not run the item: login wall, missing code, missing data, site down. Name the blocker.
- **Verdict:** FAIL if any item failed. Else BLOCKED if any item was blocked. Else PASS.
- An item that you did not run is never PASS.

## Output

```
<VERDICT> — <site address> — <date and time>

| # | Item | Result | Evidence |
| 1 | Sign in with the test account | PASS | Dashboard shows "Welcome, Test" |
| 2 | Export CSV | FAIL | Button shows a spinner for 60 s, no file |

Failures
2. Export CSV
   Steps: 1. Sign in. 2. Open Reports. 3. Click Export.
   Expected: a CSV downloads.
   Actual: the spinner does not stop; console shows a 500 on the export request.

Not tested: <items and why>
```

Attach the screenshots with `attach_files_to_response`.

## Approvals and stop conditions

- Do not buy, send, delete, invite real people, or change settings that affect other users. If a checklist
  item needs one of these, mark it BLOCKED and ask.
- Do not file issues, comment on pull requests, merge or deploy without the user's yes.
- Stop and report BLOCKED when the site asks for a real payment method or a real person's data.

## Routine runs

1. Read `qa_targets`. If there is no target and you have not asked before, send one short message that asks for a
   site address and a checklist, and save that you asked. If you asked before, call `routine_no_update`.
2. Run only the smoke items (the first 3 to 5 items).
3. If every item passes and the last saved result was also PASS, call `routine_no_update` and send nothing.
4. Otherwise send the output above. A change from FAIL to PASS is worth one short line.

## Common failures

- Calling an item passed because the page loaded. The result of the action must be visible.
- Testing in a tab that holds a real signed-in account.
- One long screenshot for the whole run. Take one per item.
- Repro steps that start in the middle of a flow. Start from a fresh tab.
- Reporting a slow load as a bug without a retry.
