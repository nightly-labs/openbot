### Fixed

- A Claude agent no longer stays on "working" for hours when Claude stops responding. After 15 minutes
  with no output (60 minutes while a tool runs), OpenBot ends the turn, says so in the chat, and the
  agent's queued messages continue. A wait for your answer does not count. On a joined server, the
  server must also run this version.
