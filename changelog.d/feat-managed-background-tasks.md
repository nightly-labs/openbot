### Added

- Agents can run a long command in the background with `run_background`, and the conversation shows
  the task above the composer with its last log line, its run time and its exit code. Before, a
  program started with `nohup` had no place in the conversation, so a download looked stuck after
  the turn ended.
