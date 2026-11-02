---
name: "Account Brief"
description: "Score a company against the user's ideal customer profile with a fixed rubric, using evidence from public company pages. Lists disqualifiers, gaps and discovery questions. Named people come only from public business pages, with no private details. Use before outreach or a first sales call."
---

# Account Brief

## When to use

- Before outreach or a discovery call with a company.
- To rank a short list of companies against the ideal customer profile (ICP).
- Not for writing the message. Use Outreach Draft after this brief.

## Inputs

1. **The ICP.** Industry, company size, region, the problem the user's product solves, buying triggers, and
   disqualifiers. If there is none, ask once with `ask_user` and offer to `remember` it for later briefs.
2. **The company.** A name or a site address.
3. **Tool path.** Call `openbot_browser.list_tabs`, then use a new tab. Read public company pages: home, product,
   pricing, careers, press, customers, documentation, and public filings. For existing relationship facts, read the
   user's CRM in a signed-in tab or an installed plugin found with `tool_search`. Read only.
4. **Paste path.** Notes, CRM exports or lists that the user gives.

## Steps

1. Write the user's offer and the ICP in two lines.
2. Collect company facts. Each fact gets a source page and the date you read it.
3. Check each disqualifier first. If one applies, mark the company Disqualified, give the evidence, and stop the
   scoring.
4. Score each criterion with the rubric. A criterion with no evidence scores 0 and goes to the gaps list.
5. Write the likely use case as an inference. Name the facts it rests on.
6. List relevant roles (for example "Head of Support"). Add a named person only when a public business page names
   them in that role: the company team page, a press release, a conference talk. Give the source.
7. Write 5 discovery questions. Each one tests a fit assumption or a gap.

## Rubric

Score each criterion 0, 1 or 2. Evidence is required for 1 or 2.

| Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Industry | outside ICP or unknown | adjacent | inside ICP |
| Size | outside range or unknown | near range | inside range |
| Region | not served or unknown | partly served | served |
| Need signal | none found | indirect (job post, docs) | stated problem on a public page |
| Trigger | none found | older than 6 months | in the last 6 months (hire, launch, funding, expansion) |
| Product fit | conflicts or unknown | needs work | fits the user's stated use case |

- **Tier:** A = 9 to 12, B = 6 to 8, C = 0 to 5. Any disqualifier = Disqualified, whatever the score.
- Four or more criteria at 0 because of missing evidence: write "Insufficient evidence" next to the tier.

## Output

```
Account Brief: <company> (<site address>), read <date>
Tier: B (7/12). Disqualifiers: none found.

| Criterion | Score | Evidence |
| Need signal | 2 | Careers page: "Support Lead, reduce response time" [3] |
| Trigger | 0 | none found (checked press and blog) |

Company facts
- <fact> [1]

Likely use case (inference): <...>, from facts [1] and [3].

People (public business pages only)
- Head of Support: <name>, team page [2]. Role only if no name is public.

Discovery questions
1. <question> (tests: <assumption>)

Gaps: <criteria with no evidence>
Sources
[1] <page title>. <company>. Accessed <date>. <site address>
```

## Approvals and stop conditions

- Do not contact anyone, send connection requests, follow accounts, or edit CRM records without the user's yes.
- Never collect private details: personal email, phone, home address, family, health, politics, or personal
  social accounts. Never guess an email address.
- Stop when a page needs a login that the user has not given you.

## Common failures

- A general company summary with no fit verdict.
- Points given for a criterion with no evidence.
- Budget, urgency or a competitor relationship stated as fact.
- A person found on a personal profile and treated as a business contact.
- Discovery questions that do not test any assumption.
