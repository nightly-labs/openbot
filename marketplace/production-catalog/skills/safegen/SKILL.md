---
name: "SafeGen"
description: "Broker approved agent actions and deterministic safety preflight without credential exposure or unsafe command execution."
---

# SafeGen

## Inputs

Proposed agent operations, terminal commands, file system writes, external API interactions, or workflow requests.

## Workflow

1. **Operation Boundary Classification**
   - Categorize actions by risk profile: Read-Only (safe to run automatically), State-Mutating (modifies files or branches), and High-Impact/Destructive (deletions, network calls, remote mutations).
   - Require explicit user confirmation for High-Impact operations before execution starts.

2. **Filesystem Containment & Traversal Guards**
   - Resolve target paths against the canonical workspace root.
   - Reject any path containing directory traversal attempts (`..`), symbolic link escapes, or operations targeting system-level directories.

3. **Credential-Blind Action Brokering**
   - Provide agents with scoped execution access without disclosing underlying master credentials or vault passwords.
   - Execute sensitive requests through broker boundaries where secrets are injected ephemerally and never logged to console or disk.

4. **Fail-Closed Verification**
   - If path verification, permission checks, or pre-execution invariants fail, halt immediately. Do not fallback to unverified defaults or proceed with partial execution.

## Deliverable

A structured safety verification report containing:
- Risk tier classification and target boundaries.
- Traversal validation confirmation (safe within workspace).
- Approval requirements (auto-executable vs. explicit approval needed).
- Sanitized execution sequence.
