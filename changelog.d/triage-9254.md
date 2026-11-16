### Fixed

- OpenCode agents no longer leave MCP apps running after a chat closes. Before, each new chat or
  subagent started more copies of apps such as Chrome DevTools, and they used more and more memory
  until OpenCode stopped. Now the chats of an agent share one copy, which stops when the last chat
  closes.
