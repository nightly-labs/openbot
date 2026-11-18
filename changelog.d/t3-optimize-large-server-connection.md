### Changed

- A joined server with many agents loads faster in the desktop app and the web client. The app reads
  the open work of all agents in one request, not one request for each agent. The server must also
  be on this version for this part.
- The app checks the routines for a time zone change only when this computer's time zone changed
  since the last check. Before, each start read the routines of each agent and channel.

### Fixed

- The web client no longer reads the pinned messages, the custom providers and the open waits of an
  agent again and again while a server loads or a reply streams.
