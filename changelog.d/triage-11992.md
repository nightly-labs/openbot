### Fixed

- When you, or an agent, set an agent's own model again after a provider error moved the agent to a
  backup model, the agent's next turn now tries that model first. Before, for up to 10 minutes after
  the error, the agent went back to the backup before it tried the model you set. If the model still
  fails, the agent moves to its backup again, as before. On a joined server, the server must also be
  on this version.
