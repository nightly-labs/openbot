### Changed

- Reconnect faster after the connection to a server drops. A failed attempt is tried again after
  0.5, 1.2, 2.7 and 4.8 seconds, and the wait after 5 failed attempts is 15 seconds. Before, the
  waits were 2, 4, 8 and 16 seconds, then 30 seconds.
- Keep the connection when a VPN or Tailscale turns on or off. The app checks the connection and
  looks for a new path, and it loads the workspace again only when the old path stopped. Before,
  each change made a new connection and loaded the whole workspace again.
- Move a connection that goes through the OpenBot relay to a direct path when one becomes
  available, for example on the same Wi-Fi or through Tailscale. This makes replies arrive sooner.

### Fixed

- Find a connection that stopped silently within about 12 seconds and reconnect. Before, the app
  could show the server as online while no new messages arrived, until a request timed out.
- Reconnect at once after a move to another Wi-Fi network. Before, the app waited until a request
  timed out.
