### Fixed

- When the GitHub tools could not start for an agent, the agent had no GitHub tools and OpenBot
  showed nothing, while Marketplace showed GitHub as connected. Now OpenBot tells you that GitHub did
  not answer, and what to do: open GitHub in Marketplace > Apps, connect it again if it asks you to,
  and start a new chat. OpenBot now also tells you when another MCP server could not start for a
  Claude agent. On a joined server, the server must also be on this version.
