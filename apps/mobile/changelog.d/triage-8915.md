### Fixed

- When a queued thread waits for a short time with no known reason, it no longer says "Waiting for a
  free thread". Before, it showed the thread limit also when none of the agent's threads ran.
