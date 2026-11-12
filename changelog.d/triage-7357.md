### Fixed

- Grok, Gemini, Muse and the other providers that are not Claude or Codex now get a local MCP server
  that has a working directory, and start it in that folder. Before, these agents did not get the
  server, although its test listed the tools. On Windows, the server starts after OpenBot has
  downloaded the runtime that it uses for MCP servers. The server settings no longer show the
  "Claude and Codex only" note.
