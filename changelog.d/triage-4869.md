### Fixed

- An agent on Grok now moves to its backup model, or waits for the window, when Grok says that its
  free usage is spent (`subscription:free-usage-exhausted`). Before, a channel task stopped with the
  error, and each later usage limit moved the agent to the spent Grok model again.
