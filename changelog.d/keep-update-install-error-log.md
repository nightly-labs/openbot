### Fixed

- When an in-app update cannot install after Restart, `main.log` keeps the error of the installer
  and `update.log` keeps `install_failed`. Before, OpenBot exited before it wrote these lines, so
  the logs showed no reason for the failure.
