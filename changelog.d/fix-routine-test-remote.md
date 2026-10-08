### Fixed

- Test or delete a webhook routine on a remote server without losing the connection. Before, the app
  read the host's empty answer as unsafe data and stopped every request to that server until you
  chose Retry.
