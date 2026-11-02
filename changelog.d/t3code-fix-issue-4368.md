### Fixed

- An agent with backup models and "Ask before switching" off now moves to its next backup model when
  its Gemini quota is spent before the agent starts to write. Before, the message failed with the
  Gemini usage-limit error, and the agent stayed on the spent Gemini model.
