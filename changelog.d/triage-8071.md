### Fixed

- When a provider did not start several times in a row, the next message or routine now starts it
  again. Before, OpenBot did not try again until you refreshed the providers or restarted OpenBot,
  so the runs of a routine failed for hours. OpenBot still does not restart the provider by itself
  after these failures. On a joined server, the server must also be on the new version.
