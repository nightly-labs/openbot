### Fixed

- A Workspace only Claude agent on a computer where Claude cannot start its sandbox, such as Windows,
  no longer stops Claude for your other agents. Before, after a few messages to that agent, OpenBot
  stopped starting Claude, and the Full access Claude agents stopped too. Now only that agent's
  message fails, with the message that tells you to choose Full access or another provider.
