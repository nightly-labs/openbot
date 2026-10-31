### Fixed

- Deleting a side thread while Codex compacts its context no longer holds the agent's own chat. Before, every later message to the agent stayed queued until OpenBot restarted.
