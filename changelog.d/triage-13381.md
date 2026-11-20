### Fixed

- A Grok agent with a local MCP server that runs a command now ends its turn and shows its reply.
  Before, a server that did not send its tool list could keep the turn running until you clicked
  Stop. OpenBot now starts these servers itself, as it does for GitHub Copilot and OpenCode agents.
  A local server that has a working folder now also works for a Grok agent. A Grok agent with
  Workspace only access does not change. On a joined server, the server must also be on the new
  version.
