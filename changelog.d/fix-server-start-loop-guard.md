### Fixed

- A server whose start fails again and again no longer starts again each 10 seconds without an
  end. It stops after 3 failed starts in a row, and a failed database migration counts as a failed
  start. It stops at once when its data is from a newer OpenBot. The log shows the reason. The
  server starts again after a restart, after `sudo openbot restart` or `sudo openbot update`, and
  the update timer tries again about each hour, with a newer release when one is available.
  `openbot status` says that the start loop stopped the server. The server must also be on the new
  version: its update installs the new service units.
