### Fixed

- A Gemini agent answers again when the Antigravity CLI 1.5.9 refuses a tool of an MCP server, such as
  the Resend `get-contact` tool. OpenBot again leaves out that server for the chat, tells you which
  server and tool it left out, and sends your message again. Before, each message stopped with a
  technical error.
