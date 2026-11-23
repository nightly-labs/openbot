### Fixed

- On Linux, a Claude agent with Workspace only access now also tells you why its commands fail when the
  Claude sandbox cannot mount its process list, for example in some containers, and asks you to choose
  Full access or another provider. Before, each command failed with a technical `bwrap` error and the
  app did not say what to do. On a joined server, the server must also be on the new version.
