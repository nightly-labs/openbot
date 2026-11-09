### Fixed

- When you go back to the app after more than about 35 seconds in another app, the app connects to
  the server again at once. Before, it first tried to recover the connection that the desktop had
  already closed. This attempt failed and made the reconnection take longer.
