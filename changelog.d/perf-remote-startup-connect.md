### Changed

- Open a joined server faster when OpenBot starts. The window no longer waits for the account's
  server list, the selected server connects while the window loads, and the hidden connection window
  loads while the session is made. A server that has no saved key still waits for the server list.
- Write the time of each step of a connection to a joined server to the local trace file, for
  diagnostics. The trace does not name the server.
