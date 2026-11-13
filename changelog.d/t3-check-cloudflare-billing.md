### Fixed

- A joined server whose connection drops again a few seconds after each connection no longer causes a
  new connection attempt every second. The desktop app now waits longer after each drop, up to one
  minute, until the connection stays up for 30 seconds. It also reads the server list again only after
  the first drop.
- The web client no longer asks for a new connection to an offline server about every 15 seconds. It
  shows the server as offline and connects when the server comes back.
- A server that cannot reach its Signal machine now waits longer between each request for a new one,
  up to 10 minutes. When the account service no longer accepts the server, the server stops these
  requests until it starts again.
- A server sends a Live Activity update to a phone only once when the phone signed in again, and it
  stops sending updates after iOS ends the activity at 8 hours.
- The web client checks a server that is not a hosted server for a hosted status only each 6 hours.
