### Fixed

- OpenCode and GitHub Copilot agents now get an MCP server that has a working directory. Before,
  these agents did not get the server, but the connection test showed it as ready and an OpenCode
  agent thought that it had its tools.
- When an MCP server takes longer to start than OpenCode waits (30 seconds), OpenBot now shows a
  message that names the server. Before, the connection test showed the server as ready, and the
  agent's calls to its tools failed with no explanation.
