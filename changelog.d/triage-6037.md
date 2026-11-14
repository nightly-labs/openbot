### Fixed

- An agent that repeated the same failed step, such as an OpenCode web search with no search text,
  went on until you stopped it and used many tokens. OpenBot now stops the turn after 5 identical
  failures, and tells you to send the message again or choose another model.
