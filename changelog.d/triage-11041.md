### Fixed

- Stop turning off the MCP servers of other apps that use Codex, such as T3 Code. Before, when an
  OpenBot MCP server had the same name as a server of another app, OpenBot saved a turned-off entry
  with that name in the Codex settings file, and the other app lost the tools of that server. Codex
  agents now get the tools of OpenBot's servers under names that start with `openbot_`, and the
  "Always allow" choices that you gave stay. A Codex agent can start a new Codex
  session one time, in the same chat. On a joined server, the server must also be on this version.
