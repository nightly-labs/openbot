### Fixed

- Start a new Claude Code session with the chat history when a chat or channel gets too long for
  Claude. Before, each later message failed with "Prompt is too long", also after a restart, until
  you started a new chat. Now the error tells you that OpenBot started a new session, and your next
  message works. On a joined server, the server must also be on this version.
