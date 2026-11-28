### Fixed

- Keep open connections to a server when its Signal machine stops. Before, the server closed all
  connections to its members, and each member had to connect again. Now the server keeps each
  member whose connection is open, and the web client, the phone and the browser extension continue
  their session on the new Signal machine. The server and the client must both be on this version.
- Move servers and their members off a Signal machine before it stops for maintenance. The moves
  are spread over time, so members do not see a failed connection.
