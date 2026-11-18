### Fixed

- A Gemini agent with backup models now moves to its next backup model when Google refuses a request
  because of a rate limit or a reached quota. Before, some of these refusals showed the rate-limit
  message but stopped the turn on the same model. On a joined server, the server must also be on this
  version.
