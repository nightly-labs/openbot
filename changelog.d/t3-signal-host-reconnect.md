### Fixed

- A server now connects to Signal again when Signal does not answer its socket. Before, the server
  could stay "online" while devices got "The host is offline." until a restart (#3749). The server
  waits 30 seconds for each answer, and checks a quiet connection every 4 minutes. After 3 minutes
  with no connection, the server shows an error and publishes itself again.
