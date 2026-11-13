### Fixed

- When a provider did not start several times in a row, OpenBot now tries it again after a wait (5
  minutes at first, then up to 1 hour). A scheduled routine then runs again by itself. Before,
  OpenBot did not try again until you refreshed the providers or restarted OpenBot, so the runs of
  a routine failed for hours. On a joined server, the server must also be on the new version.
