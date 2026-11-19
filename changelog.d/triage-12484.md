### Fixed

- An agent in a channel with backup models set to "Automatic" now moves to its backup model when its
  model stops a channel task, for example when the Gemini quota is used up. Before, the agent stayed
  on the same model, and each next channel task failed again.
