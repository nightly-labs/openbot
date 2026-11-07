### Fixed

- A server now connects to Signal again when Signal does not answer its socket. Before, the server
  could stay "online" while devices got "The host is offline." until a restart (#3749). The server
  waits 30 seconds for each answer, and checks a connection with no traffic for 4 minutes. After 3
  minutes with no connection, the server status and `openbot status` say that other devices cannot
  reach it. The message goes away when the connection comes back.
