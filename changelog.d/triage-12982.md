### Fixed

- An agent that answers a Telegram chat now still sees the earlier messages of that chat after
  OpenBot or its server restarts. Before, the chat history that the agent read was empty after each
  restart, for example after an update. OpenBot keeps these messages on the computer that runs it for
  90 days, and deletes them when you disconnect the chat.
