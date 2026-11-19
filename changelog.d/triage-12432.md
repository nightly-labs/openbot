### Fixed

- An agent with backup models set to "Automatic" now moves to its next backup model in more cases.
  Before, it stayed on its model and asked you to choose another model, or to send your message
  again, when its model hit a rate limit after the agent started work, when Gemini lost its
  connection to Google, or when Gemini could not use the model ("Unknown model ID").
