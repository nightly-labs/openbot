### Fixed

- An agent no longer runs on a different model when its provider stops offering the agent's model.
  Before, Gemini could resume a chat with a model list without the agent's model, such as Gemini 4
  Hydrogen, and the agent ran on Gemini 3.8 Flash while its settings still showed its own model. Now
  an agent with backup models moves to the next one and tells you. An agent with no backup models
  stops and asks you to choose another model. A server must also be on this version.
