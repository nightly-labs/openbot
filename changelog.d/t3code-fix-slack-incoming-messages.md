### Fixed

- Slack mentions and direct messages reach OpenBot again. Before, when a computer with a Slack
  workspace was off, each channel message of that workspace failed in Slack. Slack then stopped
  sending events to the OpenBot app for all workspaces, with no error in OpenBot.
