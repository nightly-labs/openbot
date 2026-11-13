### Fixed

- On a slow or unstable network, a joined server no longer shows "The remote request timed out." and
  fails to load the open chat while the server still answers. Before, the app stopped waiting for
  some reads after 15 seconds, also when they only waited behind earlier answers. Now a read fails
  only when the server sends nothing for 15 seconds, or after one minute.
