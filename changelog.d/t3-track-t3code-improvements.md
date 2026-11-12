### Fixed

- Claude agents use less of your plan when your Claude settings set `ENABLE_TOOL_SEARCH` to `auto`
  and the model has a 1M context. Before, Claude sent the full definition of each tool in each
  request. Now OpenBot keeps tool search on, and Claude loads a tool only when it needs it.
- A Claude agent that continues a chat after a pause waits for its MCP servers before its first
  request, so that a slow server does not seem to have disconnected.
