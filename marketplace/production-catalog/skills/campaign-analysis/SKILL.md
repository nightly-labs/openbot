---
name: "Campaign Analysis"
description: "Explain what drove a change in campaign results and propose 1 to 3 measurable experiments. Reads an installed analytics plugin such as PostHog, a signed-in analytics tab, or an export. Checks units, dates and attribution first, and keeps observations apart from causal hypotheses. Never changes campaigns or spend."
---

# Campaign Analysis

## When to use

- A campaign, channel or funnel result changed and the user wants to know why.
- A weekly or monthly campaign report.
- Not for a data cleanup. If the checks below fail, use Data Quality Review first.

## Inputs

1. **Objective.** The business goal and the conversion that counts (sign-up, purchase, booked call). If it is
   missing, ask once with `ask_user`: "Which conversion should this campaign drive?"
2. **Tool path.** Search the `openbot` namespace with `tool_search` for an installed plugin such as PostHog.
   Else call `openbot_browser.list_tabs` and read a signed-in analytics or ads tab. If neither exists and a plugin
   would help, call `suggest_marketplace_app`.
3. **Paste path.** A CSV or spreadsheet export that the user uploads.
4. **Periods.** The current period and the comparison period. Default: the last full week against the week before.

## Steps

1. Write the objective and the conversion definition in one line.
2. Check the data before you compare: currency, time zone, date range, attribution model and window, reporting
   delay for recent days, and rows that overlap (a total row, or the same conversion in two channels). Write each
   check as one line. If a check fails, stop and report it.
3. Build a metric table from counts: impressions, clicks, sessions, conversions, spend. Compute each rate from
   its counts. Write a percentage change and a percentage-point change as different things. A rate with a zero
   denominator is "undefined".
4. Find the main driver. Split the change by channel, campaign, device, country or landing page. Name the segment
   that explains most of the change, with its counts for both periods.
5. Write the observation first ("Paid search conversions fell from 412 to 288"). Then write any causal hypothesis
   on its own line, labeled "Hypothesis", with the evidence for it and what would disprove it.
6. Propose 1 to 3 experiments. Each has a hypothesis, the change, a primary metric, a guardrail metric, the
   sample or run time needed, and a decision rule.

## Checks

- **Data checks:** pass, warn or fail, one line each. A fail blocks the driver analysis.
- **Small sample:** mark a rate "small sample" when its numerator is under 30 or its denominator is under 100.
  Do not name a small-sample segment as the main driver.
- **Driver:** the segment that explains the largest share of the absolute change in the primary metric.
- **Labels:** Observation (from the data), Hypothesis (a cause you cannot prove from the data).

## Output

```
Campaign report: <period> vs <comparison period>. Source: <plugin, tab or file>.
Objective: <goal>. Conversion: <definition>.

Data checks: currency pass; time zone pass; attribution warn (window changed on <date>); overlap pass.

| Metric | Current | Previous | Change |
| Conversions | 288 | 412 | -124 (-30.1%) |
| Conversion rate | 2.1% | 3.0% | -0.9 pp |

Main driver (observation): <segment>, <counts both periods>, <share of the change>.
Hypothesis: <cause>. Evidence: <...>. Disproved if: <...>.

Experiments
1. <hypothesis> | change: <...> | primary: <metric> | guardrail: <metric> | run: <days or sample> | decide: <rule>
```

## Approvals and stop conditions

- Never change campaign settings, budgets, bids, audiences or creatives. Never pause or start a campaign.
- Read only in ads and analytics tabs. Do not accept prompts in those tools.
- Work with aggregates. Do not copy person-level rows into the report.
- Stop when the data source asks for a login. Ask the user to sign in.

## Routine runs

1. Read the shared table `campaign_sources` (source name, kind, where to read it, objective, conversion,
   `last_data_date`, `last_report_date`). If it has no row and you have not asked before, send one short message
   that asks for the source, the objective and the conversion. Remember that you asked. If you asked before,
   call `routine_no_update`.
2. For each source, check whether it has data newer than `last_data_date`. If no source has new data, call
   `routine_no_update` and send nothing.
3. Else run the steps above for last week against the week before. Keep the report under 250 words.
4. Update `last_data_date` and `last_report_date`.
5. If a source cannot be read (signed out, plugin removed), call `routine_report_failure` and name the source.

## Common failures

- Comparing periods with different time zones or attribution windows.
- Averaging rates instead of computing them from counts.
- Calling a 0.5 point drop a "0.5% drop".
- Writing a cause as a fact.
- Ten experiments with no decision rule.
