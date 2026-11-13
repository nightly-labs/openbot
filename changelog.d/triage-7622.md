### Fixed

- An OpenCode agent gets messages again after its folder moved. Before, each message to the agent
  failed with "session … does not belong to cwd". The agent now starts a new session with its chat
  history.
