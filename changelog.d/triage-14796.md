### Fixed

- On macOS, a Grok, Gemini, OpenCode or other sandboxed agent with "Workspace only" access now runs its commands in its sandbox without an approval card, as Codex and Claude agents do. Before, each command waited for "Allow", so a scheduled routine stopped until somebody answered. A command that tries to write outside the workspace still fails.
