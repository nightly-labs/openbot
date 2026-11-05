### Fixed

- Codex agents with many MCP servers use less context. Before, each request sent the full tool list
  of each MCP server. Now Codex finds these tools when the agent needs them. Computer Use tools stay
  in each request.
