### Fixed

- When more than 4 questions, approvals or browser steps waited at the same time, a question could
  have no card in its chat after the app started again, reloaded, or connected to a server again. The
  agent still waited for the answer, and its other messages stayed queued. Now the card shows, and you
  can answer it. On a joined server, the server must also be on the new version.
