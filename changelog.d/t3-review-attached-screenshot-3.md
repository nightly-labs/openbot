### Fixed

- On a Linux computer with a Wayland session, OpenBot now starts when no monitor is on, for example
  after an automatic update. Before, it stopped with no window until a monitor came on. With no
  monitor, OpenBot now starts on XWayland, and the next start uses Wayland again.
