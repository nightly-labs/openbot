### Fixed

- On Linux, a Claude agent with Workspace only access now tells you why its commands fail when the
  Claude sandbox cannot start, for example in a Docker container, and asks you to choose Full access
  or another provider. Before, each command failed with a technical `bwrap` error and the app did not
  say what to do. On a joined server, the server must also be on the new version.
