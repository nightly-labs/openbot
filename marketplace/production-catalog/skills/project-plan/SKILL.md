---
name: "Project Plan"
description: "Write a dated scope document: problem, what is in, what is out, how completion is measured, the first deliverable, risks, decisions needed and owners. It stays a draft until the user approves it, and no build work starts before that."
---

# Project Plan

## When to use

- Before work starts on a feature, a project or a launch, to agree what "done" means.
- When a goal is vague, or a request keeps growing.
- When the user wants to change an approved scope. Write a new version; do not edit the old one in place.
- Not for task tracking, release notes or the build itself.

## Inputs

1. **The goal.** From the user, an issue or project (read it with `gh` or an installed plugin such as Linear or
   Notion), meeting notes, or a pasted brief. Search the `openbot` tools with `tool_search` to find a plugin.
2. **Constraints.** Deadline, people, budget, and what is already decided.
3. If the problem or the user it affects is not clear, ask one question with `ask_user`. Do not ask more than
   one question before the first draft. Write the rest as labeled assumptions.

## Steps

1. Write the problem in two sentences: who has it, and what it costs them now. Quote the source of each fact.
2. Write **In**: 3 to 7 items. Each item is a result a person can see, not an activity.
3. Write **Out**: the items that a reader could expect but that this scope does not cover. Name at least two.
4. Write the **done-measure**: one to three checks that a person can run and get yes or no. Give each a number,
   a place to look, or a test step. "Users like it" is not a check. "A new user finishes sign-up in under 2
   minutes in 4 of 5 tries" is a check.
5. Name the **first deliverable**: the smallest piece that proves the riskiest assumption. Give it a date only
   if the user gave a date or capacity. Otherwise write "date: to agree".
6. List up to five **risks**. Each has a trigger (what you would see) and a response (what you would do).
7. List the **decisions needed**. Each has the options, who decides, and when it blocks work.
8. List **owners** per item. Use only names the user or the source gave. Else write "unassigned".
9. Set the status to "Draft — waiting for approval" and the date to today.
10. Run the Decision Quality Check on the done-measure and the first deliverable when the stakes are high.

## Checks

- Every In item is a visible result. Every Out item is specific.
- Every done-measure gives yes or no.
- No date, estimate or owner that a source does not support. Inference is labeled "assumption".
- The scope fits on one screen. If it does not, split it into two scopes.

## Output

```
# Scope: <short name>
Version <n> — <date> — Status: Draft — waiting for approval

Problem: <two sentences, with source>
In:
- <result>
Out:
- <item> (why: <reason>)
Done when:
1. <check> — measured by <where or how>
First deliverable: <piece> — date: <date or "to agree"> — proves: <assumption>
Risks:
- <risk> — trigger: <signal> — response: <action>
Decisions needed:
- <question> — options: <A / B> — decides: <name or unassigned> — blocks: <item>
Owners: <item> → <name or unassigned>
Assumptions: <list>
```

If the user wants a file, save it in the workspace as `scope-<short-name>.md`.

## Approvals and stop conditions

- No build work, no tasks in a tracker, and no messages to owners until the user approves the scope.
- When the user approves, change the status to "Approved <date>" and keep the text unchanged.
- A change after approval makes a new version with one line per change and its reason.

## Common failures

- An In list of activities ("research", "design") instead of results.
- A done-measure that no one can check.
- Dates and owners that nobody gave you.
- Starting the build because the draft looked complete.
- An empty Out list, so the scope grows without notice.
