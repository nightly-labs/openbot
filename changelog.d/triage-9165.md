### Fixed

- When an agent changes the provider, model or account of an agent that is working, and then reads
  that agent's setup, it now sees the change that waits for the next turn. Before, it saw only the
  current account and model, so it could say that the change was lost.
