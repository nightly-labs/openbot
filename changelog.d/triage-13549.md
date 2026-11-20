### Fixed

- Devin did not download in Settings > Providers. Each try stopped with "Runtime download failed
  with HTTP 403.", because Devin removed the version that OpenBot downloaded. Now OpenBot downloads
  Devin CLI 3000.14.30821, and a new try looks for the newest Devin version again when an earlier
  update check failed. On a joined server, the server must also be on the new version.
