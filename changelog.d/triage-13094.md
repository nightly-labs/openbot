### Fixed

- When ChatGPT blocked a message because of its safety rules, each later message in the same chat
  could be blocked too, until you started a new chat. Now, when the agent did no work for that
  message yet, OpenBot removes only the blocked message from what the agent sees, so the agent keeps
  the rest of the chat and your next message can continue. The error now says what happened and
  what to do next. On a joined server, the server must also be on the new version.
