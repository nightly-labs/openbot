### Fixed

- DeepSeek models now work when an MCP server, such as Webflow, has a tool with a `[` in a regex character class. Before, DeepSeek refused each request with a 400 error.
