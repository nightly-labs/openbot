### Fixed

- OpenBot starts faster when agents used GitHub Copilot, OpenCode or another ACP provider for a long
  time. Before, each start read the history of every finished session of these providers again, and
  this could take many seconds. Now OpenBot reads such a session one more time and then skips it.
