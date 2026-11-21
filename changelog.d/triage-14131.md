### Fixed

- On macOS and Linux, an agent can start a long job, such as a build or a server, in a zsh shell
  again. Before, the command that OpenBot told the agent to use failed in zsh, and the job did not
  start.
