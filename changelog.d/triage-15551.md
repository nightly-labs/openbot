### Fixed

- A Grok agent no longer stays on "working" for up to 100 minutes when one of its tools, such as an MCP app, does not return. When a tool sends nothing for 30 minutes, OpenBot ends the turn, tells you that Grok stopped responding, and starts the next message in the queue. Questions and approval cards from the agent stay open until you answer them. On a joined server, the server must also be on the new version.
