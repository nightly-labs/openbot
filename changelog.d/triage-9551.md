### Fixed

- A Gemini agent's background work, such as a dev server or a long command, no longer stops when
  another chat or a routine finishes a turn. OpenBot now keeps the Gemini process while that work
  runs: for 30 minutes after the agent's turn ends, and longer while the agent keeps working on it.
  Before, OpenBot could stop the process after some minutes, and the agent then said that its
  background tasks had stopped because the server restarted. On a joined server, the server must
  also have this version.
