### Added

- Choose when Claude compacts a chat. In Server settings > Providers > Claude > Context, set
  "Compact chats at" to a size from 100K to 1M tokens. A lower size keeps turns fast and cheap. A
  higher size keeps more detail of the chat. "Claude Code default" keeps the size that Claude Code
  chooses for each model, as before. A model with a smaller context window compacts at its own limit.
  The change applies to the next Claude process. It also works for a joined server, on the web client
  and in the mobile app, when the server is also on this version.
