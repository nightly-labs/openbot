### Fixed

- On Windows, an agent that uses the Claude provider with many MCP servers can answer messages again. Before, each message failed with "The agent could not continue. Try again.", because the MCP servers made the command that starts Claude too long for Windows.
