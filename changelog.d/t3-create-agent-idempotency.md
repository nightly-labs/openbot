### Fixed

- When the answer to a new agent got lost on a joined server, a second try no longer makes a second
  agent or sends the first message two times. The server gives the agent of the first try. The
  server must also be on this version.
- When you send a message in a thread again after a failed send, the server no longer stores it two
  times. This works on the desktop app and the web client.
