### Fixed

- After you go back to the app, the server status counts only the connection attempts that failed.
  Before, an attempt that stopped because you left the app also counted. Then the app could show
  **Reconnecting 3/5** and wait 9 seconds a few seconds after you came back, with no failed attempt.
