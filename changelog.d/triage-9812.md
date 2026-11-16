### Fixed

- A Claude agent that gets a message while it has a finished or stopped background task now sends
  its real answer. Before, the sender could get "no written result" a few seconds after the message,
  while the agent still worked on it. Agents on a server need the server on this version.
