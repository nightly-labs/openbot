### Changed

- A message that you send while an Antigravity agent works now goes into the running turn, as it does
  for Claude, Codex and Grok. It does not wait in the queue until the turn ends. This needs Antigravity
  CLI 1.5.0 or later. While the agent waits for your approval or answer, the message stays in the
  queue. On a joined server, the server must also be on this version.
