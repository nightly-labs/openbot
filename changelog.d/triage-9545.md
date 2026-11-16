### Fixed

- A Grok agent gets the tools of an MCP server whose name has symbols, such as "Google pessoal —
  leitura", or starts with a digit. Before, Grok did not accept the name and the agent got none of
  the server's tools, with no message. On a joined server, the server must also be on this version.
