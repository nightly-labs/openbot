---
name: "AiScrubber"
description: "Scrub secrets, API keys, tokens, and invisible Unicode watermarks from prompts, code diffs, and context before sharing."
---

# AiScrubber

## Inputs

Source files, git diffs, environment files, terminal logs, or diagnostic dumps intended for agent processing or sharing.

## Workflow

1. **Secret & Credential Identification**
   - Scan for cloud provider credentials, private keys, authorization tokens, database connection strings, high-entropy secrets, and password assignments.
   - Detect both standard key names and inline credential assignments in configuration files and scripts.

2. **Deterministic Redaction**
   - Replace sensitive values with uniform placeholders (such as `<REDACTED_SECRET>` or `<REDACTED_KEY>`) to preserve formatting and syntax validity while preventing credential leakage.
   - Never commit or log raw secrets during inspection.

3. **Invisible Unicode & Steganography Scrubbing**
   - Detect and strip zero-width characters (zero-width spaces, zero-width joiners, byte-order marks) and bidirectional override controls from prose, markdown, and code strings.
   - Ensure clean ASCII or standard UTF-8 text without tracking artifacts or tokenizer-manipulation sequences.

4. **Internal Network & Identity Shielding**
   - Redact private IP blocks (RFC 1918), internal hostnames, corporate email handles, and sensitive user identifiers from diagnostic outputs and bug reports.

## Deliverable

Provide sanitized text or diff output alongside an audit summary detailing:
- Number of credentials detected and redacted.
- Types of sensitive patterns scrubbed.
- Confirmation of zero residual secret tokens or invisible Unicode sequences.
