### Fixed

- A channel routine no longer skips a run with no trace. Before, when the last run of a channel routine
  still had an open or stopped task, or the routine skips runs at the usage limit, OpenBot moved the
  routine to its next time and showed nothing in its history. Now the history shows "Skipped: the last
  run had not finished" or "Skipped: usage limit reached", as it does for the routines of one agent.
  To let the routine run again, continue, reassign or cancel the stopped task in the channel. For a
  channel on a joined server, the server must also be on this version.
