### Fixed

- When "Use my Claude Code setup" is off, OpenBot no longer loads your Claude Code setup to get the
  Claude model list and usage. Before, a slow setup could make these checks time out, so the model
  list did not update and Claude usage did not show. A joined server must also be on the new version
  for its agents to get this fix.
