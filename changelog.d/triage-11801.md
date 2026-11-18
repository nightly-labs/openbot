### Fixed

- An OpenCode, GitHub Copilot or Pi agent continues when one of its local MCP servers stops during a
  tool call. Before, the tool call got no answer, and the agent showed "working" with no activity
  until the user stopped it. On a joined server, the server must also be on this version.
