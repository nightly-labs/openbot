### Changed

- The browser extension gets changes to agents, channels, pins, the sidebar and messages from a
  joined server as they occur. It asks the server for full lists less frequently.

### Fixed

- In the web client, a new message in the open channel shows without a full reload of the channel.
  Before, the preload of other channels stopped the live updates of the open channel.
- After a lost connection to a joined server, the browser extension connects again and keeps the
  open chat. Before, it stayed offline until you opened it again.
- After a client connects to a joined server again, live updates continue. Before, the server could
  stop the updates for that client until the next reload. The server must also be on the new
  version.
