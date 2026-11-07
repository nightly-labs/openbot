### Fixed

- A routine run can now read routines with `openbot.list_routines`, so a task such as `routine-healthcheck` can inspect agents' routines. Before, the routine wrapper prompt told the agent not to list routines, and the task could not read them.
