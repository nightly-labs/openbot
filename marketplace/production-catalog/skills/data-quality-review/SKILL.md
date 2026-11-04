---
name: "Data Quality Review"
description: "Check a dataset before analysis: row counts, duplicates, missing values, units and currency, date ranges and time zones, joins, and outliers. Returns a pass, warn or fail table and names which analysis each problem blocks. Use before a report, a model, or a decision that rests on the data."
---

# Data Quality Review

## When to use

- Before an analysis, a report or a dashboard that uses data you have not checked.
- When two reports disagree and the user wants to know which data is wrong.
- Not for the analysis itself. After the review, use the analysis skill the user needs, such as Campaign Analysis.

## Inputs

1. **The data.** Tool path: a shared table (`openbot.list_tables`, then `openbot.query_data`), an installed plugin
   found with `tool_search` (Airtable, Supabase, PostHog), or a signed-in tab in `openbot_browser`. Paste path: a CSV
   or spreadsheet that the user uploads.
2. **The intended use.** The calculation the data must support decides what blocks. If it is missing, ask once
   with `ask_user`: "What will you calculate from this data?"
3. **The row meaning and key.** What one row is (an order, a session, a day per campaign) and which fields make it
   unique. If the user does not say, propose one and state it as an assumption.

## Steps

1. Count rows. Compare with the source total or an expected count when one exists.
2. List the fields, their types, and the 3 to 6 fields the intended use needs.
3. Run each check below on those fields. Record the count of affected rows and 1 to 3 example row numbers or keys.
4. For each warn or fail, write why it matters to the intended calculation.
5. Propose a fix with a before and after example. Do not apply it.
6. Write the verdict and what the user can still do with the data as it is.

## Checks

| Check | Pass | Warn | Fail |
| --- | --- | --- | --- |
| Row count | matches source or expected count | differs by under 1% | differs by 1% or more, or unknown with no total |
| Duplicates | no repeated key | repeats outside the fields summed | repeated key in rows that are summed |
| Missing values | none in needed fields | under 5% in a needed field | 5% or more, or any in the key |
| Units and currency | one unit and one currency per field | unit not stated but consistent | mixed units or currencies in one field |
| Dates and time zones | range covers the period, one stated time zone | time zone not stated | gaps in the period, or mixed time zones |
| Joins | 99% or more of keys match, no fan-out | 95% to 99% match | under 95% match, or one row becomes many |
| Outliers | none past 3 times the interquartile range | present and explained | present, unexplained, and they move the result |

- An empty value and a zero are different. Count them apart.
- The user can set other thresholds. Use theirs and say so.
- **Verdict:** FAIL if any check that the intended use needs fails. Else WARN if any warn. Else PASS.

## Output

```
Data Quality Review: <dataset>, <row count> rows, read <date>.
Intended use: <calculation>. Row = <meaning>. Key = <fields>.
Verdict: PASS | WARN | FAIL

| Check | Result | Affected | Evidence | Blocks |
| Duplicates | FAIL | 214 rows | order_id 1043, 1044 repeat | revenue totals |
| Time zones | WARN | all rows | no zone stated; times end at 23:00 | daily counts at day edges |

Proposed fixes (not applied)
- Duplicates: keep the latest row per order_id. Before: 2 rows for 1043. After: 1 row, total 49.00.

What you can still do now: <analyses that are not blocked>
Assumptions: <...>
```

## Approvals and stop conditions

- Do not change, delete or overwrite source data. Write a fixed copy only on the user's yes, to a new table or file.
- Mask personal data in evidence: show a key or a row number, not an email or a name.
- For a very large file, say that you checked a sample, its size, and how you chose it.

## Common failures

- Counting a zero as missing, or a missing value as zero.
- Removing outliers without showing them.
- A join that multiplies rows and inflates totals without anyone noticing.
- Pass for a check that was not run. Write "not checked" and the reason.
