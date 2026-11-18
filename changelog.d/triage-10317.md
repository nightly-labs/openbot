### Fixed

- A custom agent, such as Claude Agent from the agent registry, starts a new session with the chat
  history when it loses its session. Before, after a restart or a model change, each message failed
  with "Resource not found", and only a new agent worked again. A joined server runs the agent, so
  the server must also be on this version.
