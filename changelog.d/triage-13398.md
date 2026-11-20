### Fixed

- An agent no longer stays "working" for hours after a restart, with its new messages waiting and no
  Stop button. Before, a message that was in progress when OpenBot or the computer restarted could
  keep the agent's queue, and another agent could not stop it. Now OpenBot closes that message the next
  time the agent gets work, and the waiting messages start. On a joined server, the server must also
  run this version.
