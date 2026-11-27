### Fixed

- A Gemini agent now keeps the model that you chose, for example Gemini 4 Neon or Argon, after
  OpenBot or the server restarts, or after Gemini stops when it is idle. Before, Gemini first listed
  only some of its models, and the agent changed to Gemini 4 Hydrogen with a note that its model was
  removed. A model that Gemini really no longer offers still changes at the next start. An agent whose
  model was changed before this fix stays on Hydrogen: select the model again in the agent's model
  picker.
