### Fixed

- A custom agent that reports a lost session as "Invalid session identifier" or "Session not found",
  as agents built on Gemini CLI do, now continues the chat in a new session with the chat history
  after the app or the agent restarts. Before, each message failed again, and only a new chat
  worked. On a joined server, the server must also be on this version.
