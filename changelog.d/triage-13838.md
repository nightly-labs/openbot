### Fixed

- A Claude agent now continues its work when the usage limit stops it while it reads the report of a
  background helper that it started by itself. Before, the agent stayed idle after the limit reset, and
  the account pool and the backup model did not move it. On a joined server, the server must also be on
  the new version.
