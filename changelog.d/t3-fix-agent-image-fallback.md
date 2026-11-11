### Fixed

- Keep the pictures of a joined server's agents while the server is offline. Before, during a restart
  of the server for an update, each agent showed its generated avatar until the server came back,
  and the picture looked lost. The desktop app and the web client now keep a copy of each picture
  that they loaded; sign-out and server removal delete it.
