### Fixed

- When a model is retired or no longer available (an HTTP 410 Gone error), an agent with automatic
  backup models now moves the message to its next backup model. Before, the turn stopped with the
  provider error, and you had to choose another model.
