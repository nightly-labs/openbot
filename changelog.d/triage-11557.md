### Fixed

- Claude Code agents no longer show the error "UNIQUE constraint failed: entries.uuid" at each start.
  When a Claude Code chat history has the same message two times, OpenBot now shows it one time and
  imports the turns that it did not save before.
