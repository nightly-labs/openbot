### Fixed

- A queued channel task now starts when the agent or normal work that held it becomes free, also when that work ended without a turn, for example when a message failed to start or was cancelled. Before, the task could stay queued until the next channel command or a restart of OpenBot.
