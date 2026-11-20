### Fixed

- An agent no longer stays "working" with its messages waiting when its chat still counts a turn
  that already stopped, for example after a usage limit. Before, the queue waited until you
  restarted OpenBot, and another agent could not stop it. Now the stopped turn shows as interrupted
  and the waiting messages start. On a joined server, the server must also run this version.
