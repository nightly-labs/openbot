### Fixed

- A Devin agent keeps its OpenBot tools after it was idle, after a reply that did not end, and after
  OpenBot restarts. Before, Devin CLI 3000.14 kept the old tool connection of the chat, and each
  OpenBot tool call of that agent failed with "Failed to connect to MCP server 'openbot'" until a full
  restart.
