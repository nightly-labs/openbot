### Fixed

- When an agent's task gives another agent an answer or a notice, a new message back from that agent
  now goes to the first agent's own chat, not to the task. The agent can now start a new task for it.
  A message that continues the task, or that answers a task that still waits, still goes to the task.
  For agents on a joined server, the server must also be on the new version.
