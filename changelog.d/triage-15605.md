### Fixed

- macOS: a Hermes agent with Workspace only access starts again. Before, each message failed with
  "Hermes stopped before it answered (exit code 1)", because the Workspace only sandbox did not let
  Hermes write its lock files. Hermes still cannot change its installed code.
