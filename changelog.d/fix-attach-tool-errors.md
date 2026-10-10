### Fixed

- When an agent cannot attach a file to its answer, it now gets the reason, for example a file outside its workspace and the shared directory, and can correct the call. Before, Codex agents got only `dynamic tool request failed` and retried the same call.
