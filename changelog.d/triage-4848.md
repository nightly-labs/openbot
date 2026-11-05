### Fixed

- On Linux, show how to fix a real-time CPU limit of 0 when the system stops a provider because of it:
  install and start rtkit, then restart xdg-desktop-portal and OpenBot. Before, the provider showed
  only "stopped before it answered (signal SIGKILL)", and each Retry removed the downloaded provider
  and downloaded it again. While the limit stays at 0, a provider update also does not download a new
  copy that the system would stop in the same way.
