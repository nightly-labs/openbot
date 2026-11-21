### Fixed

- When a rate limit stops an agent and each of its automatic backup models is on hold after a
  recent failure, the agent now waits until the first backup is free and then continues. Before,
  the turn failed with a raw "API Error: 429" text and you had to change the model by hand.
