### Fixed

- A queued message no longer waits until a restart after a turn end fails to save. Before, a context
  compaction that the turn end started to prepare held the agent, and each next message waited with
  the reason "compaction".
