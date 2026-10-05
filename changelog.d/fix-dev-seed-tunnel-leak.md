### Fixed

- A development start no longer keeps its Slack tunnels open when it cannot prepare the local
  development data. Before, the start stopped with the tunnels still open and the worktree still
  marked as busy, so the next start refused to run.
