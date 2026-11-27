### Fixed

- A routine or workflow run of a Claude agent no longer loses the tools of an app (MCP server) that did not answer for a few seconds when the run started. Before the run starts, OpenBot now tries to connect such an app again for up to 30 seconds. Before, the run continued without the tools of that app, while a chat and the connection test worked. Chats do not change.
