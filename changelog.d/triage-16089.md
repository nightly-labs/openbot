### Fixed

- Servers: a member who was removed and then joined again from a new invitation is active on the
  server again when they connect. Before, the server kept the member as disabled, so direct messages,
  agent access in channels and notifications did not work for that member. The server must also be
  on the new version.
