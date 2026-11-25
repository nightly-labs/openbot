### Fixed

- An agent with backup models set to switch without asking now moves to its next backup model when
  the provider sends a reply that is not valid or reports an internal error, before the agent starts
  work. Before, the agent stayed on its model, and the chat asked you to choose another model.
