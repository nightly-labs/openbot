### Fixed

- A custom endpoint on a llama-swap server no longer unloads the agent's model at the start of a new chat. OpenCode asked its `small_model` for a chat title, and llama-swap loaded that model, then loaded the agent's model again. OpenBot does not use these titles, so it now turns them off.
