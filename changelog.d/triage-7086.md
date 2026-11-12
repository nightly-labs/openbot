### Fixed

- A Grok agent at Workspace only now uses OpenBot's own tools, such as sending a message to another
  agent, without an approval card. Before, each of these tool calls waited for Allow, so a scheduled
  run stopped when nobody was there. A write outside the workspace and a tool of another server still
  ask. On a joined server, the server must also be on the new version.
