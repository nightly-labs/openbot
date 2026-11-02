### Fixed

- Routine runs such as `routine-healthcheck` can now read routines with `openbot.list_routines`.
  Before, the routine wrapper prompt told the agent not to list routines during a run (#4406).
