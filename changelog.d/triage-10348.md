### Fixed

- A Pi or DeepSeek agent that makes its chat history shorter before it starts a task no longer
  fails the task after 30 seconds. Before, the agent then showed as ready while it still worked:
  new messages to it failed with "Agent is already processing", Stop did nothing, and the first
  task ran later anyway, so work could run twice. For an agent on a joined server, the server must
  also be on the new version.
