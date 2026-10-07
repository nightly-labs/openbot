### Fixed

- Increase the provider message size limit from 128 MB to 256 MB to allow larger individual records.
- Allow model and provider changes after recovery from a stopped provider. Before, a stale active turn could block the change after Codex exceeded the message size limit.
- Read provider history in pages and keep completed history on disk. Long chats no longer require a retained copy of the full provider transcript.
- Preserve saved messages and attachments when a history import fails or resumes after a restart.
- Require Codex CLI 0.156.0 or newer for bounded history reads. The bundled runtime is updated to 0.160.1.
- Bundle the internal error-reporting package so the desktop can start correctly.
