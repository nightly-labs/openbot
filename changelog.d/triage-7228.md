### Fixed

- Let Gemini agents (Antigravity) answer when an MCP server has a tool whose input format Gemini cannot read, such as the email of the Resend server. OpenBot now leaves that server out of the chat, tells you which server and tool it left out, and sends the message again. Before, each message stopped with "Agent execution terminated due to error.", and the chat did not name the server.
