### Fixed

- A Gemini agent's background work, such as a dev server or a long command, now keeps running after
  the agent's turn ends. Before, OpenBot could stop the Gemini process when another chat or a routine
  finished a turn, or after some minutes. That cancelled the work, and the agent said that its
  background tasks had stopped because the server restarted. On a joined server, the server must also
  have this version.
