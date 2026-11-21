### Fixed

- When an agent asks a teammate for work and the teammate starts a task for it, the agent now waits
  for the task's result. The teammate's reply is the answer that it gives after the task report, and
  "Waiting for replies" stays until that answer comes. Before, the reply came when the task started,
  with only a "started" message, and the agent did not get the result. On a joined server, the server
  must also be on the new version.
