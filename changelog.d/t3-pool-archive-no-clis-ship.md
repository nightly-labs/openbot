### Changed

- When a hosted server moves to a new machine, its archive no longer holds the provider CLIs that
  OpenBot downloaded. At start, the server downloads the CLI of each provider that an agent uses, so
  the move copies less data.
