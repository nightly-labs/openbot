### Changed

- The web client gets a file from a joined server faster. The file is ready when its last byte
  arrives, and the client does not check and encode the whole file again at the end.
