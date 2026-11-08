### Fixed

- Codex no longer shows "The agent could not continue" when you turn on an under-development feature, such as `async_compaction`, in the Codex `config.toml`. This Codex warning does not stop the agent. OpenBot now writes it to the log only.
- When agent settings or an avatar cannot be saved, the error now shows only in the settings panel. Before, the same error also showed as a message in the chat.
