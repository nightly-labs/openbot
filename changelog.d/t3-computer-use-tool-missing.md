### Fixed

- A routine run and a chat in a routine thread have Computer Use again when it is on for the agent.
  Since 0.61.0, each routine runs in its own thread, and these threads did not get the Computer Use
  tools, so a scheduled task that uses a desktop app, such as Messages, could not run.
