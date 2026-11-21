### Fixed

- An automatic provider CLI update, a provider restart after its model settings change, and a delayed
  environment reload no longer stop background work that a Gemini agent still runs after its turn: background
  commands, background subagents and timers. Before, these stopped the provider when no turn ran, and the
  agent then reported that all its subagents and background tasks were stopped "due to server restart". Now
  they wait until that work ends. Other agents can start new turns while the update or restart waits.
  A restart that you start yourself works as before.
