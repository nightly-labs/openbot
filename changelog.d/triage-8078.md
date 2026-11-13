### Fixed

- A Hermes agent answers again after Hermes loses its chat session, for example after the Hermes gateway
  restarts. Before, each task from another agent and each message to it failed with "Internal error:
  not_found". OpenBot now opens the session again, or starts a new Hermes session with the chat history.
