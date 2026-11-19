### Fixed

- When an agent builds a workflow that starts from GitHub, Discord, Telegram or Slack, it now must
  use an event that OpenBot knows. Before, an agent could save an event name such as
  `pull_request.opened`, the workflow saved with no error, and new pull requests or messages never
  started it. Now the agent gets the correct event names and corrects the trigger in the same chat.
  For a workflow on a joined server, the server must also be on the new version.
