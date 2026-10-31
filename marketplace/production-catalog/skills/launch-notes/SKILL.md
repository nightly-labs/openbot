---
name: "Launch Notes"
description: "Write release notes from merged work, with a launch checklist that has owners and acceptance checks. Keeps done, planned and blocked work apart. Use before a release or a launch announcement. It never publishes."
---

# Launch Notes

## When to use

- Before a release, to say what changed for users.
- Before a launch, to list the work left, who owns it, and how each item is checked.
- Not for writing a scope (use Project Plan) or testing the release (QA Tester does that).

## Inputs

1. **Merged work.** In this order:
   - `gh` in the workspace when the user is signed in to GitHub: merged pull requests since the last release
     tag or a date the user gives.
   - An installed plugin such as Linear, Atlassian or Notion. Find it with `tool_search` in the `openbot` tools.
     Read issues that are done, in progress and blocked.
   - A pasted list, changelog or meeting notes.
2. **Release name and date.** If they are missing, ask once with `ask_user`. Else write "release: to name".
3. **Audience.** Users, customers or the internal team. Default: users.

## Steps

1. Collect each item with its evidence: pull request number, issue key, or the line of the pasted list.
2. Sort each item into one group:
   - **Done:** merged, or closed as done. If you cannot see that it is released, write "merged, not yet released".
   - **Planned:** open, not started or in progress.
   - **Blocked:** marked blocked, or waiting on a named decision or person.
3. For each Done item, write one line about what the user can now do or what is fixed. Remove internal names,
   refactors and test changes unless they change behavior.
4. Mark a breaking change. Name who is affected and what they must do. If the source gives no action, write
   "action: to confirm". Do not invent steps.
5. Write the launch checklist. Each item has an owner, a due date, an acceptance check, and a status. Use only
   owners and dates from the sources. Else write "unassigned" and "date: to agree".
6. List the facts to confirm before publication.

## Checks

- Every note line has evidence. No line comes from an open item.
- Planned and Blocked items never appear in the release notes.
- Every checklist item has an acceptance check that gives yes or no.
- Numbers, names and dates come from a source. Inference is labeled.

## Output

```
# <Release name> — <date> — Draft, not published

## New
- <what users can now do> (#123)
## Fixed
- <what is fixed> (LIN-45)
## Breaking changes
- <change> — affects: <who> — action: <step or "to confirm">

## Launch checklist
| Item | Owner | Due | Acceptance check | Status |
| Pricing page updated | unassigned | to agree | New price shows on the pricing page | Planned |

## Not in this release
Planned: <items with evidence>
Blocked: <item> — waiting on: <decision or person>

## Confirm before publication
- <fact>
```

## Approvals and stop conditions

- Never publish, post, send, tag a release, or close or move issues without the user's yes.
- Do not write an announcement or a social post unless the user asks. Use the same facts when you do.
- Stop and ask if the sources disagree on whether an item shipped.

## Common failures

- Writing a planned feature as shipped because an issue exists.
- Notes full of internal names that users do not know.
- A checklist with no owners, or owners nobody named.
- A breaking change with no user action.
- Mixing items from two releases because the date range was wrong.
