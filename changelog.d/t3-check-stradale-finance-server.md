### Fixed

- A server stays reachable after an OpenBot connection service restart. Before, when the server could
  not move to a new connection service during the restart, it sometimes stayed on the old one while
  your apps looked for it on the new one. The server then looked online, but no app could connect
  to it until it restarted. The server must be on this version.
