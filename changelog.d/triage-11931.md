### Fixed

- OpenBot now adds an MCP server when one of its tools describes a field as `true` or `false`, as
  JSON Schema permits. Before, the server test failed with "Invalid input", no tools loaded, and the
  server was not added. On a joined server, the server must also be on the new version.
