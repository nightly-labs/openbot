### Fixed

- An agent on a custom endpoint, such as a local model, is no longer stopped with "stopped
  responding" after 5 minutes of silence. A custom endpoint now gets 30 minutes before OpenBot ends
  the turn. On a joined server, the server must also be on the new version.
