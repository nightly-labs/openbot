### Fixed

- In a later turn of the same chat, a Pi, DeepSeek or other Pi-based agent could search again for MCP
  tools that it had already loaded, get no results, and then say that the tools of your MCP server
  were missing. The agent is now told that these tools stay loaded and that it can call them by name.
