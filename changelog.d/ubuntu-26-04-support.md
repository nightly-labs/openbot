### Changed

- The Linux docs and the Linux download page on openbot.run now name Ubuntu 26.04 LTS. OpenBot
  0.48.1 runs on Ubuntu 26.04 with the Electron sandbox on.

### Fixed

- The x64 remote desktop runtime now finds all its libraries on Ubuntu 26.04 LTS. Before, it
  needed `libminiupnpc.so.17` and `libicuuc.so.74`, which Ubuntu 26.04 does not have. The server
  install now also installs `libnuma1`, which the runtime needs. A remote desktop session on Ubuntu
  26.04 was not tested.
