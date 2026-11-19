### Fixed

- When a custom agent or another ACP agent does not answer while OpenBot opens its session, the
  work no longer stays at "starting" forever. After 5 minutes with no output from the agent,
  OpenBot ends the agent's process and shows that the agent did not answer in time. A channel task
  for that agent then shows that it could not start, and the agent's other channel tasks can start.
