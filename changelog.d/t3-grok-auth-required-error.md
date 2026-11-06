### Fixed

- When a provider, such as Grok, cannot use an MCP server from your MCP settings, OpenBot now shows an
  "MCP server not started" message that names the server. A server that asks for a sign-in tells
  you to sign in to it, and the message has an "Open MCP settings" button. Before, the provider's raw
  text showed as a provider error, and the provider row showed "Error" while the provider worked. A
  server whose name was not in that text showed no message at all. Each server shows its message
  once while OpenBot runs.
