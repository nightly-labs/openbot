### Fixed

- A server with many agents and open threads answers the apps again while messages wait for a free
  turn. Each check for a free turn read all agents and threads again, so the server could stop
  answering for minutes and the apps could not connect. Only the server must be on this version.
