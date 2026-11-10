### Added

- The agent dock can float at the edge of the screen on Linux. It stays above other windows and on
  all workspaces, and clicks outside its agents go to the window under it. On an X11 desktop it
  works at once. On a Wayland desktop, Settings > Agent dock offers to start OpenBot again on
  XWayland; until then, the dock shows in the OpenBot window.
- The Dynamic Island shows at the top centre of the screen on Linux. It stays above other windows
  and on all workspaces, and clicks outside the island go to the window under it. Hover opens it,
  and you can answer requests and reply from it. On a Wayland desktop, Settings > Dynamic Island
  offers to start OpenBot again on XWayland.
- A self-hosted or hosted OpenBot server does not open the Dynamic Island or the agent dock on its
  virtual display. No user sees them there, and computer-use agents do not see them in screenshots.

### Changed

- The idle Dynamic Island stays still while the pointer is away: the greeting does not change and
  the logo does not blink. This uses less CPU. With the pointer on the island, both move again.
