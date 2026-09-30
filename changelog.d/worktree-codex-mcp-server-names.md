### Fixed

- With Codex (GPT models), an agent now gets the tools of an MCP server whose name has a space or
  another character that is not a letter, a digit, `_` or `-`, such as "Home Assistant". Before, the
  connection test passed but the agent got none of the server's tools.
