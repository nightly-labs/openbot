### Fixed

- Show a notice when a Codex model is at capacity. Codex then waits about 5 minutes between tries,
  and before, the agent showed as working with no output for 15 minutes or more. The notice shows
  at the first capacity retry that OpenBot gets, about 5 minutes after the send, and tells you to
  stop the turn and choose a different model to continue now. It shows on the desktop, in the web
  client and on mobile. For an agent on a joined server, the server must also be on the new version.
