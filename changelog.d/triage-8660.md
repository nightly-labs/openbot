### Fixed

- A Gemini agent that waits for a long command now continues by itself when the command ends. Its
  next steps and their approval requests show in the chat. Before, the agent stopped with no message.
  About 5 minutes later, OpenBot stopped the Gemini process, and that cancelled the work. You had to
  send another message to get the result. On a joined server, the server must also have this version.
