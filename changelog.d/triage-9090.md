### Fixed

- When a scheduled routine did not start because its last run had not finished, or because it skips
  runs at the usage limit, the routine moved to its next time and the run history showed nothing.
  Now the run history shows the skipped time and the reason. More skips for the same reason in a row
  show as one entry. To show the reason on a joined server, the server must also be on this version.
