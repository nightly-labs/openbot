### Fixed

- An agent can again create a channel, send feedback, or do other actions that only your request
  can start, when you ask for it in its chat while it waits for answers from teammates. Before, the
  answers that came in early went into the same turn as your message, so the agent refused your
  request and asked you to send it in the chat. Now your message starts its own turn, and the agent
  reads the teammate answers together when the last teammate answers.
