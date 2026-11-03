### Fixed

- An agent with backup models and "Ask before switching" off now moves to its next backup model when
  its ChatGPT, Claude, Grok or Muse credit balance or quota is spent before the agent starts to write.
  Before, the message failed under the usage notice, and the agent stayed on the spent model.
