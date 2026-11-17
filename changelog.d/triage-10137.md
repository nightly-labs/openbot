### Fixed

- When an MCP server that runs as a command stops during Test connection, OpenBot now shows the
  last message that the server wrote, for example a missing environment variable. Before, it showed
  only "The server stopped before it answered" and told you to run the command in a terminal, where
  the command often worked. Keys in the message are hidden. For a server that you test on a joined
  server, the server must also be on the new version.
