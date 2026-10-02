### Added

- Install OpenBot as a server on a Linux computer with no screen, such as a VPS, from a terminal:
  `curl -fsSL https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh | sudo bash`.
  Sign it in with `sudo openbot login`, and use it from the desktop app, the iPhone app or
  openbot.run/app. The `openbot` command also shows the status and the log, changes the server name,
  installs updates, and removes OpenBot with `sudo openbot uninstall`. The install also works on Debian
  12, Debian 13 and Ubuntu 26.04. See docs/self-hosted-server.md.
