### Fixed

- When ChatGPT could not start an MCP server in a chat, a passing **Test connection** now gives the agent the server's tools again from the next message, also for a server with no sign-in. Before, the tools stayed missing in that chat until you started a new chat.
