---
name: "Meeting Actions"
description: "Turn meeting notes or a transcript into decisions, commitments with owner, due date and quoted evidence, open questions and conflicts. Use after a meeting, before a follow-up, or when someone asks who agreed to what."
---

# Meeting Actions

## When to use

- After a meeting, to get a record of what was decided and who owes what.
- Before a follow-up message, or when people disagree about what was agreed.
- Not for meeting prep or a calendar review. Use Daily Brief for those.

## Inputs

1. **Notes or transcript.** First look for a signed-in document tab: call `openbot_browser.list_tabs` and read the
   notes or transcript page that the user names. An installed plugin such as Notion also works; find it with
   `tool_search`. Else ask the user to paste the text or upload the file.
2. **Meeting date and time zone.** Take them from the document header or the calendar entry. If they are missing
   and the notes use relative dates ("Friday", "next week"), ask once with `ask_user`.
3. **Attendees.** Use the names in the notes. Do not add people who are not named.

If the transcript has no speaker labels, say so at the top of the output. Then do not assign owners from guesses.

## Steps

1. Read the whole text once before you extract anything. Later lines often change earlier ones.
2. Sort each candidate line into one class: decision, commitment, suggestion, open question.
   A suggestion ("we could ...") or a wish ("someone should ...") is not a commitment.
3. For each commitment, record who, what, by when, and the evidence: a short exact quote and the timestamp or
   line number. The owner is the person who said "I will" or who accepted a clear request. Mentioning a task
   does not make a person its owner.
4. Write "no owner" or "no date" when the meeting did not set one. Never fill the gap.
5. Convert a relative date to a calendar date only when the meeting date and time zone are known. Keep the
   original words next to it: "2026-11-06 (said: Friday)".
6. Find conflicts: two statements that cannot both be true, a decision that a later line reverses, or two owners
   for one task. Quote both sides.
7. Merge exact duplicates. Keep two commitments apart when the deliverable or the owner is different.
8. List the open questions that block a commitment, and name the commitment they block.
9. When the user confirms the list, save the commitments to the shared data table `commitments` with
   `openbot.execute_data`: owner, task, due date, status, meeting, evidence. Use one row per owner and task from one
   meeting, and update the row when it exists. Daily Brief reads this table.
10. Draft follow-up messages only when the user asks. Write them in the chat.

## Rubric

A commitment is **firm** when it has an owner, a deliverable and the person's own agreement in the text. It is
**unclear** when one of the three is missing; mark which one. A decision is **final** only if no later line
reopens it. Every item needs evidence. An item without a quote or line is removed, not guessed.

## Output

```
Meeting: <title> — <date, time zone> — source: <tab, file or paste>

Decisions
1. <decision> — "<quote>" (<timestamp or line>)

Commitments
| Owner | Task | Due | Status | Evidence |
| Ana | Send the revised quote | 2026-11-06 (said: Friday) | firm | "I'll send it Friday" 00:14:32 |
| no owner | Book the venue | no date | unclear: no owner | "someone needs to book it" 00:21:05 |

Open questions
- <question> — blocks: <commitment>

Conflicts
- "<quote A>" (<ref>) vs "<quote B>" (<ref>)

Not in the source: <what the user may expect but the notes do not say>
```

## Approvals and stop conditions

- Do not send follow-ups, post to a channel, create tasks in a task tool or edit calendar entries without the
  user's yes. Drafts stay in the chat until then.
- Do not claim that you attended the meeting. Work only from the given text.
- Stop and ask when the text is cut off or is clearly from another meeting.

## Common failures

- Turning "we should look at pricing" into an owned task.
- Inventing a due date from the next meeting date.
- Losing the speaker when a transcript line says "I'll do it". Read the line before it.
- Writing a summary instead of a quote as evidence.
- Merging two different tasks because they share a keyword.
