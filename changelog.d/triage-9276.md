### Fixed

- A routine now tells the agent the date and time of each run in the routine's timezone. Before, the
  agent got only the UTC time, so a routine near midnight, such as a daily summary at 23:30 in São
  Paulo, could work on the wrong day. On a joined server, the server must also be on this version.
