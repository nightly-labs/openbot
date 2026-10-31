---
name: "Call Scorecard"
description: "Score a sales call transcript from 1 to 5 on seven named criteria, each with a timestamped quote as evidence, then give the top 3 fixes for the next call with a better line to try. Works from a pasted or uploaded transcript, or a transcript in a signed-in call recorder tab. Never invents quotes."
---

# Call Scorecard

## When to use

- After a sales call, to see what to change before the next one.
- To compare calls by the same rep over time.
- Not for account research. Use Account Brief for that.

## Inputs

1. **Transcript.** Paste path: text or an uploaded file (TXT, VTT, SRT, DOCX, PDF). Tool path: the transcript view
   of a call recorder in a signed-in tab (`openbot_browser.list_tabs` first). You cannot transcribe audio. If the
   user has only a recording, ask for the transcript export from their recorder.
2. **Speakers.** Which speaker is the rep. If labels are unclear, ask once with `ask_user`.
3. **Call type.** Discovery, demo, or closing. It changes which fixes matter most.

## Steps

1. Read the full transcript. Number the lines if there are no timestamps.
2. Count words per speaker. Compute the rep's share of the words.
3. For each criterion, find the moment that decides the score. Copy the quote word for word, 25 words or fewer,
   with its timestamp or line number.
4. Score each criterion with the anchors below. If the moment never came up (no objection was raised), write N/A
   and the reason. Do not score it.
5. Compute the overall score: the mean of the scored criteria, one decimal.
6. Pick the top 3 fixes: the lowest scores that matter most for this call type. For each, write what happened
   (quote), why it matters, and a better line to try.

## Rubric

- **Agenda:** 5 = purpose, time and desired outcome agreed in the first minutes; 3 = purpose stated, not agreed;
  1 = no agenda.
- **Discovery depth:** 5 = open questions with follow-ups into impact and cause; 3 = open questions, no follow-up;
  1 = closed questions or none.
- **Listening ratio:** rep share of words. 5 = 45% or less; 4 = 46 to 55%; 3 = 56 to 65%; 2 = 66 to 75%; 1 = over
  75%. Say that it is from word counts, not talk time.
- **Problem confirmation:** 5 = rep restates the problem and the buyer confirms it; 3 = restated, not confirmed;
  1 = never restated.
- **Value tied to stated pain:** 5 = each feature shown links to a pain the buyer said, in the buyer's words; 3 =
  some links; 1 = generic pitch.
- **Objection handling:** 5 = acknowledges, asks a question to understand, answers, checks; 3 = answers without
  checking; 1 = argues or ignores.
- **Next step:** 5 = specific step with a date, owner and buyer agreement; 3 = vague ("I'll send something"); 1 =
  none.

Scores 2 and 4 sit between the anchors.

## Output

```
Call Scorecard: <call name or date>. Type: discovery. Rep: <speaker label>.
Overall: 3.1 / 5 (6 of 7 scored)

| Criterion | Score | Evidence |
| Agenda | 2 | [00:01:12] Rep: "So, let me just show you the product." |
| Listening ratio | 2 | Rep 71% of words (word count) |
| Objection handling | N/A | No objection raised |
| Next step | 3 | L214 Rep: "I'll follow up next week sometime." |

Top 3 fixes for the next call
1. Next step. Happened: L214 "I'll follow up next week sometime." Why: no date, no buyer commitment.
   Try: "Can we book 30 minutes on Thursday with your ops lead to check the import?"
```

## Approvals and stop conditions

- Do not send the scorecard to the rep, a manager, a CRM, or a chat channel without the user's yes.
- Transcripts hold other people's words. Do not save them to shared tables or memory unless the user asks.
- Score the rep only. Do not judge the buyer.

## Common failures

- A quote that is a paraphrase. Copy the exact words or do not quote.
- A score with no evidence line.
- Scoring objection handling when no objection came up.
- Ten fixes instead of three.
- A "better line" that is generic advice instead of words the rep can say.
