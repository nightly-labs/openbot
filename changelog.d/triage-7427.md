### Fixed

- A Gemini agent can now use every tool of an MCP server that you added by its web address. Before,
  Gemini gave the agent only the tools that fit in its limit, so with a large server, such as Product
  Hunt or Trello, most tools did not work and the agent said that they were not available. OpenBot now
  runs these tools for the agent, and asks you to approve each call as for other MCP tools, unless the
  agent has Full access. On a joined server, the server must also be on this version.
