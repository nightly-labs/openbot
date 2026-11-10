### Fixed

- The Gemini model list now shows the models in Google's order, best first, such as Gemini 4 Argon
  first on a Google AI Ultra plan. Before, GPT-OSS 120B came first, and new Gemini agents ran it.
- When a provider stops offering an agent's model, the agent now moves to the newest model of the
  same family, such as Claude Opus 4.6 to Claude Opus 5.5. Before, it moved to the first model in the
  list. Between two models of one version, an agent on a thinking model takes the thinking model.
- A model such as GPT-OSS 120B no longer comes first in a model list: its size, 120B, is not a version.
