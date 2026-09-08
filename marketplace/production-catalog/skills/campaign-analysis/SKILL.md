---
name: "Campaign Analysis"
description: "Analyze supplied campaign metrics for performance, data gaps, and evidence-based next experiments."
---

# Campaign Analysis

## Inputs

Use the export, period, business objective, conversion definition, and comparison period. Work only from metrics and definitions actually supplied.

## Workflow

1. Check currency, timezone, attribution windows, reporting delays, and whether rows overlap before comparing totals.
2. Compute rates from their underlying counts where possible. Distinguish percentage change from percentage-point change and report zero-denominator cases as undefined.
3. Segment enough to locate the driver of a change without presenting tiny samples as reliable trends. Separate correlation from causal explanations.
4. Recommend experiments with a hypothesis, primary metric, guardrail, and a condition for making a decision. Do not change spend or campaigns during analysis.

## Deliverable

Return the main result, a compact metric table with calculation definitions, likely drivers with evidence, data limitations, and prioritized experiments.
