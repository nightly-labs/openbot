### Fixed

- When a Claude agent ends a teammate's update quietly but starts background work, the agent's later
  report on that work can now end quietly too. Before, that report always showed as a new unread
  answer in the chat. The report of work that you asked for still shows. For an agent on a joined
  server, the server must also be on this version.
