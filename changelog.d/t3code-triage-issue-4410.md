### Fixed

- Codex agents get the tools of an MCP server that starts slowly, for example an `npx` server after OpenBot starts. Before, Codex waited 1 second for the server, and the first turn of the session did not have its tools.
