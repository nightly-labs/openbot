### Fixed

- An OpenCode agent gets the tools of an MCP server that you signed in to again after one failed
  connection, for example while the sign-in had expired. Before, the agent could not find the tools
  ("Unknown tool") until you quit and opened OpenBot again, although the connection test said
  "ready". Now the tools come back at the agent's next message after you sign in again or test the
  server.
