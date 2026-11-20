### Fixed

- An Antigravity routine run that had nothing to report now ends when the agent says so. Before, the
  run stayed active for up to 30 minutes when a command still showed as running, and the routine
  skipped its next times with "Skipped: the last run had not finished".
