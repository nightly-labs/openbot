### Fixed

- When an agent reads the work steps of an earlier turn, such as a failed routine run, it now gets
  the tool steps, commands and errors that the chat shows. Before, it got "Captured work steps are
  unavailable" unless the agent had changed its provider after that turn.
