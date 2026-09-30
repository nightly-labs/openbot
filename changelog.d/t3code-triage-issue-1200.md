### Fixed

- Keep the other devices connected to a desktop when one phone reconnects. Before, a late network
  message from the old connection of that phone could disconnect every device from the desktop.
- Keep the web client connected through a short network change. Before, it made a new connection
  after 5 seconds without an ICE restart, and it retried only every 10 seconds.
