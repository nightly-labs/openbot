---
name: "Competitor Comparison"
description: "Compare products or vendors against criteria chosen from the decision. Every table cell has a source, prices carry the date they were checked, and a fact that was not found is marked unknown. Use to choose a tool, to position a product, or to check a claim about a competitor."
---

# Competitor Comparison

## When to use

- The user must choose between products, vendors or plans.
- The user wants to position their product against named alternatives.
- Not for an open research question. Use Evidence Brief for that.

## Inputs

1. **The decision.** Who decides, what they choose, and what is a must-have. If this is missing, ask once with
   `ask_user`: "What decision does this comparison feed?"
2. **The options.** 2 to 6 products. If the user names none, propose up to 4 from a search and ask them to confirm.
3. **Tool path.** Call `openbot_browser.list_tabs`, then use a new tab. Read each vendor's product pages, pricing
   page, documentation, changelog and status or limits pages. Search the `openbot` namespace with `tool_search`
   for an installed plugin that holds the user's notes (Notion, Airtable).
4. **Paste path.** Trial notes, sales calls, spreadsheets or screenshots that the user gives.

## Steps

1. Write the decision in one sentence.
2. Choose 5 to 8 criteria from the decision, not from the vendors' feature lists. For each, write what counts as
   meeting it, and mark it must-have or nice-to-have. Show the criteria once and ask the user to confirm them.
3. For each option and criterion, find a source: official documentation, the pricing page, the changelog, or a
   test that you or the user ran. Record the source and the date you read it.
4. Fill each cell with a short value and its source number. Write "unknown" when the documentation and pricing
   page do not answer it. Write "not offered" only when the vendor says so.
5. For pricing, record the plan name, the list price, the currency, the billing unit (per seat, per month, per
   usage), and the date checked. "Contact sales" is a value. Do not estimate a price.
6. Mark claims such as "fastest" or "most secure" as "vendor claim". Do not count them as Meets.
7. Score each cell with the rubric. Then name the best fit for each scenario the user cares about.
8. Write a short check plan for the unknowns that could change the result.

## Rubric

- **Meets:** a documented or tested capability satisfies the criterion.
- **Partial:** it covers part, needs a higher plan, or needs a workaround. Say which.
- **Does not meet:** the vendor states it is absent, or a test failed.
- **Unknown:** no source found. Unknown never counts as Meets.
- An option that does not meet a must-have is out for that scenario.
- Name an overall winner only when the must-haves separate the options. Else give the best fit per scenario.

## Output

```
Decision: <one sentence>. Checked <date>.

| Criterion (must/nice) | Option A | Option B | Option C |
| SSO on the team plan (must) | Meets [1] | Partial: Enterprise only [4] | unknown |
| Price, 10 seats, monthly (must) | USD 120 per month, Team plan, checked 2026-10-31 [2] | Contact sales [5] | ... |

Best fit
- <scenario>: <option>, because <cells>.

Unknowns to check
- <option, criterion>: <how to check: ask sales, run a trial step, read a page>

Sources
[1] <title>. <vendor>. Accessed <date>. <site address>
```

## Approvals and stop conditions

- Do not sign up for trials, book demos, contact sales, or enter payment details without the user's yes.
- Do not publish the comparison unless the user says "publish".
- Stop and ask when a pricing page needs a login or a quote form.

## Common failures

- Criteria picked after the research, so they favor one option.
- A feature written from memory instead of from a source.
- A price with no date, plan name or billing unit.
- An empty cell filled with a guess instead of "unknown".
- One winner when the answer depends on the scenario.
