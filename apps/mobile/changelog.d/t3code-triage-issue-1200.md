### Fixed

- Keep the connection to your desktop when the phone changes between Wi-Fi and mobile data, or
  loses mobile data for a short time. Before, the app made a new connection after 5 seconds,
  waited 10 seconds between attempts, and waited 2 minutes after 5 failed attempts.
- Reconnect as soon as the phone gets a network again, not at the next planned attempt.
- Keep a new connection over a slow mobile network. Before, the first check of the desktop stopped
  after 3 seconds and started the connection again.
