### Fixed

- When an agent asks for a local skill or a skill revision that does not exist, it gets a clear
  message. The message says that the skill does not exist, or gives the latest revision. Before, the
  agent got a system error with a file path (`ENOENT`). It then could not correct its call, and the
  install of a skill for another agent stopped.
