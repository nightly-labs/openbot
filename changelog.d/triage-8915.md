### Fixed

- A queued thread now says "Waiting for the agent to restart." while the agent's provider starts or
  updates. Before, it said "Waiting for a free thread. 4 threads run now." also when none of the
  agent's threads ran. When a thread waits for a short time with no known reason, it no longer shows
  the thread limit.
