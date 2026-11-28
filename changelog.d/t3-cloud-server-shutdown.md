### Fixed

- Servers and apps connect again within seconds after a Signal update. Before, a Signal update could
  keep a server offline for about 5 minutes, because each server that reconnected sent its own
  check to the account service at the same time.
