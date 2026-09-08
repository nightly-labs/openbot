---
name: "Workflow Playbook"
description: "Turn a repeatable process into an executable human playbook and a scoped automation specification."
---

# Workflow Playbook

## Inputs

Identify the trigger, inputs, people, tools already available, expected output, and current failure points. Do not assume access to a service simply because it is named.

## Workflow

1. Map each step to its input, action, output, and owner. Separate decisions from mechanical transformations.
2. Define completion, retry limits, duplicate prevention, and the state needed to resume safely after interruption.
3. Identify which external changes require authorization and where a person must resolve ambiguity. Keep credentials out of the playbook.
4. Propose automation only for steps with available inputs and a verifiable result. State integration gaps instead of claiming the workflow is connected.

## Deliverable

Return the process, exception handling, acceptance checks, and a minimal automation plan. Draft instructions or code only at the level requested; do not enable a recurring job without a request.
