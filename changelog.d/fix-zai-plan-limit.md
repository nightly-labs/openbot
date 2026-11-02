### Fixed

- An agent on an OpenCode model with the z.ai GLM Coding Plan now moves to its backup model, or
  waits for the window, when z.ai says "Usage limit reached for 5 hour" or "Weekly/Monthly Limit
  Exhausted". Before, the turn failed as a normal error.
