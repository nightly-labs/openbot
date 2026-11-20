### Fixed

- A hosted server now installs a downloaded update after it waits 24 hours, also when a browser view,
  a remote desktop, a browser control, a provider sign-in or a connected client is still open. Before,
  these could stop the update for many days. The server still waits for agent turns, routines,
  message deliveries, channel work, file transfers, provider installs and agent setup. The server log
  now shows what the update waits for, and how long it waited.
