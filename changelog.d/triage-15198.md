### Fixed

- A Claude agent keeps its running background commands and subagents when you add or turn on an MCP server, sign in to one, give an agent access to one, or when OpenBot installs a tool runtime. Before, these changes stopped the background work at once, and the agent did not report back. The agent gets the new MCP servers when its background work ends. Removing a server, turning it off, signing out or taking access away still applies at once.
