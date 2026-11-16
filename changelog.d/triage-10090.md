### Fixed

- On macOS, an OpenCode agent with Workspace only access can use the models of a custom endpoint
  again. Before, the first message failed with an `EPERM` error from npm. An agent on a joined
  server runs on that server, so the server must also be on this version.
