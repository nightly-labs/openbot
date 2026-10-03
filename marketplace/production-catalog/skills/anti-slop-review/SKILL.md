---
name: "Anti-Slop Review"
description: "Audit code changes and pull requests for over-engineering, unrequested abstractions, broad dictionary types, leaked secrets, and unsafe operations."
---

# Anti-Slop Review

## Inputs

Use the pull request diff, modified files, caller call-sites, and repository rules. If architectural intent or test reproduction steps are missing, identify the smallest missing context needed.

## Workflow

1. **Over-Engineering Audit (YAGNI & Ponytail)**
   - Check if the added code needs to exist at all. Reject speculative flexibility, single-implementation interfaces, single-product factories, and premature configuration for constants that never vary.
   - Favor native platform capabilities and the standard library over adding or expanding dependencies.
   - Prune boilerplate and defensive try/catch padding wrapped around pure functions. The shortest working diff that solves the root cause wins.

2. **Type & Module Boundary Strictness**
   - Reject loose escape hatches (`any`, `unknown` used to bypass checkers, unconstrained dictionary types like `Record<string, any>`). Enforce concrete contracts across process, IPC, and module boundaries.
   - Ensure imports flow strictly in one direction. Check that no circular dependencies (`noImportCycles`) are introduced.
   - Verify that interfaces and types represent real domain invariants, not arbitrary bags of properties.

3. **Privacy & Secret Preflight (Scrubber Invariants)**
   - Audit the diff for accidentally committed credentials: API keys, tokens, session hashes, private URLs, and auth headers. Ensure credentials resolve strictly through sanitized environment variables.
   - Detect and strip invisible Unicode characters (such as zero-width spaces, zero-width joiners, and bidi override control sequences) from prose, markdown, and code strings.
   - Ensure error logs and diagnostic strings redact sensitive user values before serialization.

4. **Deterministic Safety Preflight (Safegen Invariants)**
   - Verify all file system and path operations enforce strict boundary containment (canonical root and realpath verification to prevent traversal attacks).
   - Ensure destructive operations require explicit user approval and fail closed on invalid inputs.
   - Avoid silent fallback swallowing; if a critical invariant or state check fails, raise actionable diagnostics rather than masking the defect.

5. **Verification Check**
   - Confirm every behavioral correction includes a focused regression test at the lowest stable boundary.
   - Verify that tests assert observable user outcomes and data contracts rather than internal implementation details or markup classes.

## Deliverable

Deliver findings grouped by severity (P0 Blocker, P1 Robustness, P2 Simplification):
- **Location**: File path and line range.
- **Violation**: The specific over-engineering, type boundary violation, or security flaw.
- **Consequence**: Concrete failure mode, security exposure, or maintenance hazard.
- **Minimal Correction**: The smallest code change or deletion that remedies the issue.
- **Verification**: The targeted test or linter command to confirm resolution.
