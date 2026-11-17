### Fixed

- On Linux, a new server on this computer starts on systems that block the user namespaces of the
  app sandbox, such as Ubuntu 23.10 and later. Before, the app opened, but each new server showed
  "The server on this computer did not start." at once.
