---
name: "Meeting Actions"
description: "Extract decisions, owners, commitments, and open questions from meeting notes or a transcript."
---

# Meeting Actions

## Inputs

Use the transcript or notes and meeting date if available. Preserve uncertainty in speaker attribution and incomplete statements.

## Workflow

1. Separate decisions from suggestions, and commitments from intentions. A participant mentioning a task does not make them its owner.
2. For each action, capture deliverable, named owner, due date, and source passage. Use unassigned or date not stated when the meeting did not establish them.
3. Resolve relative dates only when the meeting date and timezone are known. Keep ambiguous dates verbatim with a clarification note.
4. Combine duplicates without merging distinct obligations. Identify dependencies and unanswered questions that block an action.

## Deliverable

Return a brief summary, decisions, an action table, and open questions. Add a follow-up message draft only when asked. Do not send messages or create tasks unless the user requests those actions.
