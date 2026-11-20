### Fixed

- When a hosted server moves to a new machine, it now downloads the Pi CLI again for agents that use
  Inception, DeepSeek or OpenRouter. Before, these agents could not reply after the move until you
  downloaded Pi in Server settings.
- When you save an Inception key in the server setup, the setup no longer shows an error about a
  DeepSeek or OpenRouter key that you did not try to add.
