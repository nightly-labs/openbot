### Fixed

- A Workspace only Claude agent on a computer where Claude cannot start its sandbox, such as Windows,
  no longer stops Claude for your other agents. Before, after a few messages to that agent, OpenBot
  stopped starting Claude, and the Full access Claude agents stopped too. Now only that agent's
  message fails.
- The message for that agent is now in plain words: Claude cannot use a sandbox on this computer, so
  Workspace only does not work for it. Choose Full access or another provider. Before, it showed
  Claude Code's own reason, such as a feature gate or missing Linux tools.
