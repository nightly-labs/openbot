### Fixed

- A Gemini agent with Full access can now use every tool of an MCP server that runs on this computer,
  as it already can for a server that you added by its web address. Before, Gemini gave the agent only
  the tools that fit in its limit, so most tools of a large local server did not work and the agent said
  that they were not available. OpenBot now runs these tools for the agent, and asks you to approve each
  call as for other MCP tools, unless the agent has Full access. An agent with Workspace only access does
  not get this. On a joined server, the server must also be on this version.
