### Changed

- Reconnect the web client faster after the connection to a joined server drops. A failed attempt
  is tried again after 0.5, 1.2, 2.7 and 4.8 seconds, and the wait after 5 failed attempts is 15
  seconds. Before, the waits were 2, 4, 8 and 16 seconds, then 30 seconds.
- Move a web client connection that goes through the OpenBot relay to a direct path when one
  becomes available. This makes replies arrive sooner.

### Fixed

- Find a web client connection to a joined server that stopped silently within about 12 seconds,
  and reconnect. Before, the server could show as online while no new messages arrived, until a
  request timed out.
