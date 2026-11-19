### Fixed

- On Linux, OpenBot opens on the first try where the AppImage runs in a sandbox, such as on NixOS. When
  OpenBot started itself again on XWayland for the Dynamic Island and the agent dock, the sandbox ended
  the new process with the first one, so it often took a few launches to open.
