### Fixed

- After a crash or a forced stop, OpenBot checks its database at the next start. On a large
  database, this check took many minutes and stopped the whole app. The check now runs in a
  separate process, so the app is not stopped while it runs. The window still opens when the check
  ends. A damaged database still stops the start with the same message as before.
