### Fixed

- Claude agents now connect to MCP servers that refuse requests from bots, such as some n8n servers and reverse proxies. Before, the server test passed, but the agent showed the server as failed with "Unexpected content type: null".
