### Fixed

- An OpenCode chat now compacts its context automatically at 80%, and the context meter has
  "Compact now". Before, the meter showed "This agent does not compact its context.", and a long
  chat sent an almost full context with each message. This used more tokens than necessary. On a
  joined server, the server must also be on the new version.
- When OpenCode refuses a free model, for example because the model is not available in the user's
  country, the error now says so and tells the user to choose a different free model. Before, the
  error said that OpenCode had no sign-in and told the user to choose a model with the Free label,
  although the chosen model had that label.
