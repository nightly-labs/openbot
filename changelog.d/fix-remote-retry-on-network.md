### Fixed

- Remote servers reconnect when the computer's network returns. Before, a plain network
  disconnect left each server waiting on its retry backoff — up to 15 minutes with the app in the
  background — although the computer was already back online, and only a wake from sleep retried
  at once.
