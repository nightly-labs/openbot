---
name: "Search Content Brief"
description: "Turn a keyword list or Search Console data into keyword groups by intent, chosen targets, and writer-ready briefs for search results and AI answers. Each brief has the question, angle, outline, sourced facts, internal links and an answer-first summary. No invented search volumes."
---

# Search Content Brief

## When to use

- The user has keywords or Search Console data and needs to know what to write next.
- A writer needs a brief for one page, or an existing page needs a plan to update it.
- Not for writing the full article or for technical site audits.

## Inputs

1. **Keywords.** Tool path: Search Console in a signed-in tab (`openbot_browser.list_tabs` first). Read the
   Queries and Pages reports for the last 3 months: clicks, impressions, position. Paste path: a keyword list or a
   keyword tool export that the user gives.
2. **The site.** The user's site address, for existing pages and internal links.
3. **The offer and audience.** What the site sells and to whom. If missing, ask once with `ask_user`.

## Steps

1. Clean the list: merge duplicates and plural forms, drop brand terms of other companies unless the user wants
   comparison pages.
2. Group keywords by topic. Label each group with one intent: Informational, Comparison, Transactional, or
   Navigational.
3. Score each group with the rubric. Pick the top 1 to 5 targets.
4. For each target, search it in a new browser tab. Record the top 5 results: page type (guide, list, product page,
   forum, video), angle, and date. Note the region and language of the search.
5. If the search page shows an AI answer, record the sources it cites. If none shows, write "no AI answer shown".
6. Search the user's site for a page on the same topic. If one exists, the brief is an update, not a new page.
7. Collect the facts the page needs. Each fact gets a source and a date. Mark facts that only the user can give
   (prices, customer results) as "from you".
8. Write the brief.

## Rubric

Score each keyword group 0, 1 or 2 on each criterion.

- **Business fit:** 2 = the offer solves the searcher's problem; 1 = related; 0 = unrelated.
- **Demand:** 2 = Search Console impressions or a supplied volume show demand; 1 = not available; 0 = data shows
  almost none.
- **Gap:** 2 = current results are old, thin, or miss the question; 1 = good but beatable on one point; 0 = strong
  and current.
- **Intent fit:** 2 = the user can make the page type that ranks; 1 = with effort; 0 = no.

Pick groups with the highest total. A tie goes to Business fit.

Search volume and difficulty come only from Search Console or a tool export that the user gives. Else write
"not available". Never estimate them.

## Output

```
Keyword groups
| Group | Intent | Keywords | Demand (source) | Score |
| Invoice approval | Comparison | approval workflow tool, ... | 1,240 impressions, Search Console, 3 months | 7 |
| Approval policy template | Informational | ... | not available | 5 |

Brief: <working title>
Target: <keyword group>. Intent: <...>. New page | Update of <page address>.
Question to answer: <one sentence>
Answer-first summary (40 to 60 words, for AI answers and the page opening): <...>
Angle: <what this page does that the current results do not>
Audience: <...>
Outline
- H2 <...>
  - H3 <...>
Facts to include
- <fact> (source: <title>, <publisher>, <date>)
- <price or result> (from you)
Internal links: <existing page title and address> as "<anchor text>"
What ranks now: 1. <type, angle, date> ...
AI answer cites: <sources> | no AI answer shown
Do not include: <claims without a source, competitor claims you cannot check>
```

## Approvals and stop conditions

- Read only in Search Console. Do not change settings, submit sitemaps, or request indexing.
- Do not publish, edit the site, or create pages in a content tool without the user's yes.
- Stop when the Search Console tab asks for a login. Ask the user to sign in.

## Common failures

- A search volume that nobody measured.
- One brief per keyword instead of one per intent group.
- A new page for a topic that the site already covers.
- A brief that copies the outline of the top result with no angle of its own.
- Facts in the outline with no source.
