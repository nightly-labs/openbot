### Fixed

- With Grok, an MCP server from `~/.claude.json`, `~/.cursor/mcp.json` or `.mcp.json` that needs
  an OAuth sign-in no longer shows a "Provider error". Before, Grok's `worker quit with fatal …
  AuthRequired` line showed as an error, but the chat worked without that server.
