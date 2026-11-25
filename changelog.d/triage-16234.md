### Fixed

- Windows: an MCP app with a command such as `npx` or `node` now starts when that command is in a
  folder with non-English letters in its name. Before, the app did not connect and showed "The system
  cannot find the path specified" as unreadable characters.
