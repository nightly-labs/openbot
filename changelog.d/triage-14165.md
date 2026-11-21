### Fixed

- A provider CLI update, a provider restart after its model settings change, and a delayed environment reload
  no longer stop background work that a Gemini or Claude agent still runs after its turn: background commands,
  background subagents and timers. Before, these stopped the provider when no turn ran, and a Gemini agent
  then reported that all its subagents and background tasks were stopped "due to server restart". Now they
  wait until that work ends, for at most 4 hours. Other agents can start new turns while the update or
  restart waits. The Restart button, a change of the provider variables and a change of the CLI choice work
  as before.
