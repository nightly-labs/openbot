### Fixed

- When the Claude process of one agent stops with an error, the other Claude agents now continue their
  work. Before, OpenBot stopped all Claude agents, also an agent in the middle of a long command. That
  agent then lost the result of its command and stopped with no message. The agent with the error
  shows the error in its chat, and its next message continues the same chat. On a joined server, the
  server must also be on this version.
