### Fixed

- Let Gemini agents (Antigravity) answer when Google refuses a tool of an MCP server, for example a TickTick tool with a list that has no item type or an empty choice. OpenBot now leaves that server out of the chat, tells you which server and tool it left out, and sends the message again. Before, each message stopped with "Agent execution terminated due to error." until you turned off the server for all agents.
