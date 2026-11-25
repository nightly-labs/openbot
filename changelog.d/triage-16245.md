### Fixed

- Agents: when a model loses a list item in a tool call, such as an MCP server header, the agent now
  gets an error that tells it how to send the item again. Before, an agent on Cursor with a Gemini
  model could not save a key that you gave it for an MCP server.
