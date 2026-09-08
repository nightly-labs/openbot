---
name: "Data Quality Review"
description: "Inspect a supplied dataset for missing values, duplicates, inconsistent units, and limits on analysis."
---

# Data Quality Review

## Inputs

Get the dataset, expected row meaning, important fields, and the intended analysis. If only a sample is available, limit conclusions to that sample.

## Workflow

1. Establish row count, field types, identifier uniqueness, missingness, and coverage. Distinguish empty values from legitimate zeros.
2. Check date ranges, units, categories, joins, and duplicate definitions against the intended use. Explain why each issue matters to a calculation.
3. Avoid silently correcting ambiguous values or dropping records. Propose transformations with before and after examples.
4. Record checks performed, affected counts, and unresolved assumptions. For large files, explain sampling or tool limits.

## Deliverable

Return a quality summary, an issue table with affected fields and counts, suggested corrections, and an assessment of which intended analyses remain supported.
