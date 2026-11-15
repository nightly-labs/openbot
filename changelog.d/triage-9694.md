### Fixed

- On Linux, a Codex agent with Workspace only access now tells you why its commands fail when
  Codex cannot start its sandbox, for example in a Docker container, and asks you to choose Ask
  first or Full access. Before, each command failed with a technical `bwrap` error and the app did
  not say what to do.
