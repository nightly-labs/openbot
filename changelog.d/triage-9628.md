### Fixed

- When you ask an agent to change an agent's provider, model or account together with other settings
  while that agent works, the change no longer fails. The other settings apply at once, and the new
  provider starts at the agent's next turn. Before, the agent got "Wait for the active turn and queue
  to finish before changing provider" and nothing changed.
