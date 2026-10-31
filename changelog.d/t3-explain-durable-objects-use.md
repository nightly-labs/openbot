### Fixed

- The account service does less database work when a phone or browser connects to a server. Before,
  each connection read the connections of all users of that server, and each server or account
  deletion read every connection of every server.
