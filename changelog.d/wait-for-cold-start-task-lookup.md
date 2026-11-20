### Fixed

- A tap on a task-reply notification opened the agent's own chat with no message when the phone had
  just started: the tap ran before the server had said whether it serves agent tasks, so the task
  lookup gave up at once. The lookup now waits for that answer, like the channel list, and still
  gives up at once when the host is offline or has no agent tasks.
