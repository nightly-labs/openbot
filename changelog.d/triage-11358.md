### Fixed

- "Delete history" of an agent's chat now works while the agent answers in Slack, Discord, Telegram or
  WhatsApp. Before, it failed with "Wait for the active turn and queue to finish before deleting the
  history." although the chat showed no turn and no queue. On a joined server, the server must also
  be on this version.
