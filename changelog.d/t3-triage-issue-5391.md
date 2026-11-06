### Fixed

- A chat or channel with one message larger than about 1.5 MB opens on a phone, in the web app and on a joined computer. Before, the chat showed "response too large" and the older messages did not load. The device now gets the start and the end of that message, up to 256 KB, with a note that tells how much is not shown. The full message stays on the computer that runs the server.

### Changed

- A message longer than 20,000 characters shows its start and a "Show full message" button. Before, the app drew the whole message, and a very long agent message could stop the window for many seconds.
