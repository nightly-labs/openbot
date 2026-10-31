### Fixed

- OpenBot now adds an MCP server whose tool schemas use `true` or `false` as a property schema, as
  JSON Schema permits. Before, the server test failed with "Invalid input" and OpenBot did not save
  the server.
