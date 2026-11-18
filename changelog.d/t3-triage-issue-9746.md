### Fixed

- OpenBot now refuses Workspace only access for a Claude agent when Claude cannot use a sandbox on
  this computer: on Windows, and on a Linux server or Docker container without a working `bwrap` or
  without `socat`. The agent settings and the agent tools `update_profile` and `update_agents` say
  that Workspace only does not work for Claude here, and the agent keeps its access. Before, OpenBot
  accepted the change, and then each message to the agent failed until you chose Full access again.
  On a joined server, the server must also be on the new version.
