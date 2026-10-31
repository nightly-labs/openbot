---
name: "Evidence Brief"
description: "Answer a research question with sourced, dated claims. Each claim has a source title, publisher, publication date and access date, and a label: Verified, Reported or Inference. Conflicts between sources stay visible. Use for fact checks, market questions, and any answer that a decision or a published claim depends on."
---

# Evidence Brief

## When to use

- A question needs an answer that the user can check: a fact check, a market or policy question, "is this still true".
- Before a decision, a pitch, or a claim that will be published.
- Not for a side-by-side product comparison. Use Competitor Comparison for that.

## Inputs

1. **The question.** If it is vague, ask once with `ask_user`: "Which decision does this answer feed?" Give 2 to 3
   options from the context.
2. **Tool path.** Call `openbot_browser.list_tabs`, then open a new tab. Use a search page to find sources and open
   each source page. For the user's own documents, search the `openbot` namespace with `tool_search` for an
   installed plugin such as Notion or Atlassian.
3. **Paste path.** Documents, files or site addresses that the user gives. Read each one in full before you cite it.
4. **Cut-off date.** Use the "as of" date that the user names. Else use today.

## Steps

1. Write the question in one sentence, with the date of the answer.
2. Find sources for each material claim. Prefer the primary source: the filing, the official statement, the
   dataset, the paper. Look for a second independent source. A copy of one press release on two sites is one source.
3. For each source, record the title, the publisher, the publication date ("no date shown" if there is none), the
   site address from the open tab, and the access date. Do not cite a search result snippet.
4. Write each claim as one sentence. Give it a label from the rubric. Attach its source numbers.
5. Look for disagreement. When sources conflict, show both with their dates. Say which one you weight more and why:
   primary, newer, or closer to the event.
6. Write the answer first: 1 to 3 sentences, at the confidence that the evidence allows.
7. List what would change the answer and the questions that stay open.

## Rubric

- **Verified:** a primary source states it, or two independent sources agree, and you read them.
- **Reported:** one secondary source states it, or the sources are not independent. Name who reports it.
- **Inference:** your conclusion from labeled claims. Name the claims it rests on.
- **Unknown:** you looked and found nothing usable. Say where you looked.
- A claim with no source that you opened is never Verified.
- On a fast-changing topic (prices, laws, leadership, product features), mark a source older than 12 months
  "may be stale".
- Confidence: high when the answer rests on Verified claims only; medium when it needs a Reported claim; low
  when it needs an Inference or a conflict is open.

## Output

```
Question: <one sentence> (answered <date>)
Answer: <1 to 3 sentences>. Confidence: high | medium | low.

| # | Claim | Label | Sources |
| 1 | <claim> | Verified | [1], [2] |
| 2 | <claim> | Reported | [3] (trade press; no primary source found) |
| 3 | <claim> | Inference | from 1 and 2 |

Conflicts
- <claim>: [2] says X (published 2026-03-01); [4] says Y (published 2025-11-12). Weighted [2]: primary, newer.

What would change this answer: <one or two items>
Open questions: <items, and where you looked>

Sources
[1] <title>. <publisher>. Published <date>. Accessed <date>. <site address>
```

## Approvals and stop conditions

- Read only. Do not post, comment, sign up, or fill in forms to reach a source.
- Stop at a paywall or a login wall. Report the source as not read. Ask the user to paste it if it matters.
- Do not publish the brief as a site unless the user says "publish".

## Common failures

- Citing a page you did not open, or a search snippet.
- Counting syndicated copies of one story as independent support.
- Mixing up the publication date and the event date. Record both when they differ.
- Hiding a conflict to give a clean answer.
- Writing a site address from memory. Copy it from the open tab.
