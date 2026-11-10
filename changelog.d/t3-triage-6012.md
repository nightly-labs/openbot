### Fixed

- Start OpenBot without a burst of processes when you have many Pi agents. Before, each Pi agent
  started its tools, MCP servers and Computer Use at startup only to read its chat history, and kept
  them for 5 minutes, so the computer could stop responding.
