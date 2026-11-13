### Fixed

- On the Linux AppImage, OpenBot keeps its files after it restarts itself (a restart when idle, or a
  restart for the dock above other apps). Before, remote desktop, Computer Use and the update check
  stopped working after such a restart, until you quit OpenBot and opened it again.
- When a remote desktop component is missing, remote desktop reports that it did not start. Before,
  OpenBot showed a JavaScript error box.
