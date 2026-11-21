### Fixed

- An agent can wait for a routine run or a script event in a side thread. Before, `await_event`
  refused a side thread, so background work never continued the side thread where the user asked.
  The run that wakes the wait continues the request in that side thread.
