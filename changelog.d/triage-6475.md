### Fixed

- An agent that sends a message to a working teammate now knows if the message went into the
  teammate's running task, or why it waits. Before, the agent got "queued" every time, also when
  the message went into the running task, so it could not tell you what happened. When the
  teammate's "While working" setting is Queue, the agent can tell you to set it to Steer.
