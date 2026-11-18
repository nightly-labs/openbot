### Fixed

- An agent no longer runs on a different model when its provider stops offering the agent's model.
  Before, Gemini could resume a chat with a model list without the agent's model, such as Gemini 4
  Hydrogen, and the agent ran on Gemini 3.8 Flash while its settings still showed its own model. Now
  an agent set to switch to its backup models without asking moves to the next one and tells you, and
  goes back after 10 minutes. Otherwise the message stops and asks you to choose another model. A
  server must also be on this version.
