### Fixed

- Pi agents find the tools of your MCP servers more reliably. Before, an agent sometimes looked for them with the OpenBot tool search, found nothing, and said that it had no such tool. That search now tells the agent to load MCP tools with Pi's own `tool_search`.
