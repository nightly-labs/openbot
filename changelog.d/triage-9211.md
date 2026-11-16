### Fixed

- On Windows, an OpenCode agent writes curly quotes and long dashes in a command in a form that
  OpenCode accepts, for example in a sentence to read aloud. Before, OpenCode refused the command
  before it ran, and the agent sent the same command again until it stopped.
