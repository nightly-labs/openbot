### Changed

- The first conversation of a joined server opens faster when the server has many agents. Before,
  the app showed it only after it read the queue of each agent. On a server with 50 agents, the
  desktop app now shows it in about half the time.
- The web app reads the agent settings, connectors and routine calendar of a server once when it
  opens, not up to three times. On a server with 50 agents, its side panels show about a quarter
  sooner.
- When you open the app again, the agents and sidebar of a joined server show at once from the last
  visit, while the app connects to the server. The saved view holds no messages. Server actions
  start when the connection is made. The channels show in their place too, and a hidden or moved
  agent stays hidden or moved in the saved view.
- The desktop app opens its window about 3 seconds sooner when the Dynamic Island is on. The window
  does not wait for the Island to load.
- A client connects to a joined server with fewer steps in sequence. The desktop app reads the
  server compatibility once, not twice. The web app loads its workspace code while it signs in, and
  on a server it connected to before, it reads the workspace at the same time as the compatibility.
  With 100 ms network latency, the web workspace is ready about 250 ms sooner.
- On the web, a switch to another server is about 2.5 times faster. The app uses the connection
  that it already keeps to that server for notifications, and it does not wait for the old server's
  session to end. On openbot.run, a switch took 0.7 to 1.0 seconds, against 1.7 to 2.8 seconds
  before.

### Fixed

- A host that starts lists its agents as soon as they load. Before, a client could wait about
  15 seconds for the list while the host ran its routine checks.
- On the web, an agent that you open while the app connects stays open after the connection.
- While a joined server connects, the conversation says that it connects. It does not ask you to
  complete the provider setup.
- While a joined server connects, a channel from the last visit does not say "No messages yet" or
  show its creation date.
