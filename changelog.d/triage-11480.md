### Fixed

- An OpenCode agent on a custom Groq endpoint answers again after it changes to a Groq model, for
  example its backup model. Before, each Groq turn in that chat failed with "property
  'reasoning_content' is unsupported" when an earlier turn came from another model with thinking on.
