### Fixed

- Agents in a channel can read earlier messages again when one of them comes from a long agent turn.
  Before, the steps of that turn filled the history that the agent read, so the agent could not see
  the messages around it.
