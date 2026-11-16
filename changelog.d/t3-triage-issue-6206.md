### Fixed

- On Windows, a Claude agent with Workspace only now says in plain words that Workspace only does not work for Claude on Windows yet, and that no setting on the computer turns it on. Before, the message and the "Claude error" notification showed the internal text of Claude Code ("feature gate off"), and the notification told the user to set `sandbox.failIfUnavailable=false`. Full access or a different provider lets the agent work (#6206).
