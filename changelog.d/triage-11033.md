### Fixed

- An agent that creates a new agent without a model no longer puts it on a different provider while
  its own model list is still loading, for example a Custom agent such as Kiro. Before, the new agent
  started on your default model and ran its first task there. Now the agent tries again or picks a
  model. On a joined server, the server must also be on this version.
