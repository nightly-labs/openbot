### Fixed

- A queued thread now says "Waiting for the agent to restart." while the agent's provider waits to
  update or restart. Before, it said "Waiting for a free thread. 4 threads run now." also when none
  of the agent's threads ran. A thread that waits for free memory now says so. A thread that waits
  for no known reason no longer shows the thread limit.
