### Fixed

- On Windows, an MCP server that starts `ssh` can be saved and used again. Before, OpenBot did not give it the `ProgramData` folder, so ssh stopped at once and OpenBot said that the server stopped before it answered.
