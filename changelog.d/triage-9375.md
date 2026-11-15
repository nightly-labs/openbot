### Fixed

- A quiet routine run that has nothing to report now ends at once when the agent's model asks
  again to end with no update. Before, a model such as Kimi could repeat the request for up to an
  hour and spend many tokens.
