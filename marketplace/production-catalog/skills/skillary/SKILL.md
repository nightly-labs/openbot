---
name: "Skillary"
description: "Author, validate, and orchestrate modular agent skills and multi-step engineering playbooks."
---

# Skillary

## Inputs

Engineering task descriptions, multi-step goals, repository guidelines, or custom agent skill requests.

## Workflow

1. **Domain & Goal Disambiguation**
   - Identify the primary discipline (development, security, architecture, documentation, operations) and target outcome.
   - Separate one-off ad-hoc prompts from repeatable, high-leverage agent skills or playbooks.

2. **Surgical Skill Authoring**
   - Structure the skill into standard sections: Inputs, Phased Workflow, Deliverable, and Verification Checklist.
   - Keep instructions self-contained, deterministic, and free of speculative abstractions or unneeded dependencies.

3. **Playbook Staging & Coordination**
   - Break large-scale technical objectives into sequential stages with clear handoff deliverables (such as architecture spec, implementation, verification, and deployment changelog).
   - Define clear stage boundaries and validation criteria between phases.

4. **Schema & Trigger Boundary Validation**
   - Ensure clean YAML frontmatter with concise name and description fields within standard catalog limits.
   - Verify that trigger phrases avoid ambiguity or overlap with existing catalog skills.

## Deliverable

A validated, production-ready skill file (`SKILL.md`) or multi-stage playbook with clear inputs, actionable steps, quality gates, and completion criteria.
