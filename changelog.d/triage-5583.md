### Fixed

- Workspace only Claude agents start again when `~/.claude/settings.json` has `env`, `apiKeyHelper` or another sign-in setting. Before, each message failed with "Cannot use both a settings file path and the sandbox option".
