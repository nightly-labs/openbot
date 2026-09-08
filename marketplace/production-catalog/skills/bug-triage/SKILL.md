---
name: "Bug Triage"
description: "Turn a bug report, logs, and reproduction steps into a testable diagnosis and a focused fix plan."
---

# Bug Triage

## Inputs

Start from expected versus actual behavior, the failing version, and available logs. Request a missing reproduction detail only when it blocks the next useful check.

## Workflow

1. Build the shortest reproduction and locate the first observable divergence. Preserve exact error text and relevant input values without copying credentials.
2. List at most three plausible causes, ranked by evidence. Choose a check that distinguishes them instead of changing several things at once.
3. Separate the trigger from the root cause and any secondary errors. If evidence contradicts a hypothesis, discard it explicitly.
4. Propose the smallest fix and a regression check. State whether reproduction and verification actually ran.

## Deliverable

Return reproduction steps, evidence, likely cause with confidence, proposed correction, and verification steps. If unresolved, give the single most useful next observation.
