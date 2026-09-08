---
name: "Change Review"
description: "Review a proposed code change for bugs, regressions, and missing behavior checks. Use with a diff and repository context."
---

# Change Review

## Inputs

Use the diff, intended behavior, affected callers, and test results. If the intent is missing, identify the smallest question that changes the review.

## Workflow

1. Trace changed inputs through callers and outputs. Read surrounding code before treating a surprising line as a defect.
2. For each candidate finding, identify a concrete trigger, the resulting wrong behavior, and the smallest correction. Discard claims that depend on assumptions the code does not make.
3. Check error handling, cleanup, retries, ordering, and compatibility with saved data where the diff touches them.
4. Suggest a focused test at the lowest stable boundary. Separate a test you ran from one you recommend. Do not modify code during a review unless asked.

## Deliverable

Lead with actionable findings ordered by impact. Each finding needs a location, trigger, consequence, and fix direction. If none are found, say so and name the meaningful limits of the review.
