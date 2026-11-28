### Fixed

- When Claude's safety check refused a message, each later message in the same chat was refused too,
  also after a model change, until you started a new chat. The chat showed only the error text of
  Claude Code. Now, when the agent did no work for that message yet, OpenBot removes only the
  refused message from what Claude sees, so the agent keeps the rest of the chat and your next
  message can continue, also after a restart of OpenBot. The error now says what happened and what
  to do next. On a joined server, the server must also be on the new version.
