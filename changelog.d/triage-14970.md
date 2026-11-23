### Fixed

- An Antigravity agent could not use an MCP server when Antigravity's own MCP settings also had a
  server with the same name, such as Parallel. Each call failed with "tool … is not enabled for
  server …", and the agent used its built-in web search instead. Now the agent calls the server that
  you added in OpenBot.
