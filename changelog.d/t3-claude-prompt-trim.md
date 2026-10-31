### Changed

- Send about 3k fewer tokens in each Claude agent request. Claude agents no longer get the
  `Workflow` and `ListAgents` tools, which OpenBot does not show, and Claude auto memory is off:
  OpenBot memory is the agent's only memory. Earlier Claude memory files stay on disk.
