### Added

- Settings > Providers has an "Update all" button. It shows when one or more providers have an update,
  and it updates all of them at once. It also works on a joined server.

### Changed

- OpenBot now updates the provider CLIs that it downloaded by itself, each hour, when a new version
  is available. Before, it did this only after an OpenBot update. The update waits until the agents
  are idle. A CLI that you installed yourself, a CLI with a custom path, and a provider that is off
  still show "Update available". If you cancel an automatic update, OpenBot does not start it again
  for that version. On a joined server, the server must also be on the new version.
