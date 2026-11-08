### Fixed

- Codex no longer shows "The agent could not continue" when you turn on an under-development feature, such as `async_compaction`, in the Codex `config.toml`. This Codex warning does not stop the agent. OpenBot now writes it to the log only.
- When agent settings or an avatar cannot be saved, the error now shows only where you made the change: in the settings panel, or in the message box for a model or fast mode change. It gives the reason from the server. If you close the panel before the save ends, a notification shows the error. Before, the same error also showed as a message in the chat.
