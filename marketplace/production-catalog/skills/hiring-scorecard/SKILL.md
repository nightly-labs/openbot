---
name: "Hiring Scorecard"
description: "Turn role requirements into competencies, structured questions for each interviewer, a 1 to 4 scale with behavioral anchors, and an evidence-only debrief. Use when you plan an interview loop or summarize interview feedback."
---

# Hiring Scorecard

## When to use

- Before an interview loop, to give each interviewer a focus, questions and a scale.
- After interviews, to put the written feedback into one evidence-only debrief.
- Not for sourcing candidates, sending offers, or ranking people on traits. The hiring team decides.

## Inputs

1. **Role requirements.** First look for a signed-in tab with the job description or the hiring plan
   (`openbot_browser.list_tabs`), or an installed plugin such as Notion (`tool_search`). Else ask the user to
   paste the job description and the level.
2. **Real work.** Two or three tasks the person will do in the first 90 days. If the user gives none, ask once
   with `ask_user`. Competencies come from this work, not from the job title.
3. **Interviewers.** Names and the stage each one runs. If missing, write the plan with "Interviewer 1, 2, 3".
4. **Feedback** (for a debrief). Scorecards or notes pasted by the user or read from a signed-in tab.

Do not store candidate names, notes or scores in shared data tables. Other agents can read them. Keep them in
the chat.

## Steps

1. **Competencies.** Write 4 to 6 competencies. Each one is a work behavior that someone can observe, such as
   "breaks an unclear request into a plan with checkpoints". Tie each one to a requirement or a task.
2. **Coverage.** Give each interviewer 1 or 2 competencies. Each competency is covered by at least one
   interviewer and by at most two. Show the coverage as a table.
3. **Questions.** For each competency, write one primary question and two follow-up probes. Use questions about
   past work ("Tell me about a time you ...") or a short work sample. Every candidate gets the same primary
   questions.
4. **Anchors.** For each competency, write one behavior for each score on the 1 to 4 scale (see the rubric).
5. **Prep pack.** For each interviewer: their competencies, questions, anchors, time plan, and one line on what
   not to ask (see stop conditions).
6. **Debrief.** Ask each interviewer for scores and evidence before they read other feedback. Then build one
   table: competency, score per interviewer, quoted evidence. Mark a score without evidence as "no evidence".
   List disagreements of 2 or more points. List the competencies with no evidence and the follow-up question
   that would close the gap.
7. **Chase.** List interviewers whose scorecard is missing and draft a short reminder for the user to send.

## Rubric

A 1 to 4 scale. Write one behavioral anchor for each score, for each competency.

- **1 — no evidence or opposite evidence.** Example: "could not name a decision they made on the project".
- **2 — partial.** Did the work with heavy guidance, or only described the team's work.
- **3 — meets the level.** Did the work alone, gave a specific example with the result.
- **4 — above the level.** Did the work and improved how others do it, with a measured result.

Rules: a score needs a quote or a concrete note from the interview. "Good culture fit", "seemed smart" and
"strong presence" are impressions, not evidence; list them apart and give them no weight.

## Output

```
Role: <title, level> — loop of <n> interviews

Competencies and coverage
| Competency | From requirement | Interviewer |

Prep pack — <interviewer>
Focus: <competency 1>, <competency 2>
Primary question: ...  Probes: ...
Anchors: 1 ... 2 ... 3 ... 4 ...
Do not ask: age, family, health, religion, nationality, or plans outside work.

Debrief — <candidate reference>
| Competency | <Interviewer A> | <Interviewer B> | Evidence |
Disagreements: ...
No evidence: <competency> — next question: ...
Missing scorecards: <names>
Decision: for the hiring team.
```

## Approvals and stop conditions

- Do not email, message or schedule candidates or interviewers without the user's yes. Drafts stay in the chat.
- Do not change records in an applicant tracking system unless the user asks for that edit.
- Never use or infer protected characteristics: age, sex, gender identity, race, ethnicity, religion,
  disability, health, pregnancy, family status, sexual orientation, nationality. Stop and flag feedback that
  mentions them.
- Do not give a hire or no-hire recommendation. Show the evidence; the team decides.

## Common failures

- Competencies copied from the job title, not from the work.
- Two interviewers asking the same question while one competency gets no coverage.
- Averaging scores that have no evidence behind them.
- Letting the first opinion in the debrief set the scores of the rest.
- Personal traits ("energetic", "polished") written as job evidence.
