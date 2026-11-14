### Fixed

- Show when a Discord server moves to another OpenBot server. When you connect the same Discord
  server on a second OpenBot server, the first one stops answering there. Before, the first server
  still showed "Connected", and its agents got the error "unknown_guild". Now it shows "Needs
  attention" and tells you to select Reconnect to link the Discord server to it again. Agents get a
  plain message.
