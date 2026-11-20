### Fixed

- A Gemini agent with Full access can now use the hidden tools of a local MCP server that must stay
  running, such as figma-console and its Figma Desktop Bridge plugin. Before, OpenBot started a second
  copy of the server for each of these tools, so the plugin never connected and each call failed. Now
  OpenBot runs the server and Gemini connects to it through OpenBot, so all tools use the same copy. A
  local server with its own working folder now also works with a Gemini agent that has Full access. An
  agent with Workspace only access does not change. On a joined server, the server must also be on this
  version.
