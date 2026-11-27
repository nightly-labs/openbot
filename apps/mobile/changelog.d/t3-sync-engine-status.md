### Changed

- Muting an agent, a channel task command, and cancelling, steering or moving a queued message now
  show at once. Before, each one waited for the server. If the server refuses the change, the old
  value comes back.
- The agents, channels, pins, routines, queued messages and the newest chat and channel messages
  now stay up to date by themselves. The server sends only what changed. The server must also be
  on the new version; with an older server, the app reads the data as before.
