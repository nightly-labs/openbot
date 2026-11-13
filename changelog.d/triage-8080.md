### Fixed

- When a Claude Code Stop hook blocks a Claude agent's reply and the agent writes the reply again,
  the chat and the Slack, Discord and other channel posts now show only the new reply. Before, the
  blocked reply and the new reply came as one message, so the answer showed two times. The blocked
  reply now shows in the agent's thinking. An agent on a joined server gets this fix when the
  server is on this version.
