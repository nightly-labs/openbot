### Fixed

- Grok chats no longer show "MCP server not started" or "Provider error" when a chat closes while
  Grok starts its MCP servers, such as Computer Use or an app from the Marketplace. Before, the
  servers worked, but OpenBot showed a failure for each of them. A failed start in an open chat
  still shows its message. An agent on a joined server gets this fix when the server is on this
  version.
