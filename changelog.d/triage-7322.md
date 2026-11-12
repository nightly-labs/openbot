### Fixed

- A WhatsApp agent now remembers the recent messages of its chats after OpenBot or the server
  restarts. Before, a restart deleted them, so the agent did not understand a reference such as "the
  report from before" and asked you to send it again. OpenBot keeps the text of the newest 200
  messages of your allowed WhatsApp chats, encrypted, on the computer that runs the agents.
  Disconnecting the number deletes them. When the agent runs on a server, the server must also be on
  this version.
