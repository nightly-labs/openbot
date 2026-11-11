### Fixed

- When the desktop app reaches a joined server through Signal but the direct connection does not
  come up in time, it now says that a firewall, VPN or proxy can block the connection. Before, it
  said only "The host is not reachable.", also when the server showed as online. Other failed
  connections still show "The host is not reachable.", now with a code that names the failed step.
  The app still tries again by itself.
