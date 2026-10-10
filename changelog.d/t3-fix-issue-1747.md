### Fixed

- Fix remote reconnects that report too many active connections when an old client socket waits for its host. Concurrent reconnects and failed authentication no longer hold extra account slots. Other device sessions stay connected.
