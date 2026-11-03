### Fixed

- When an agent hands off a channel task with a missing field, an unknown source message id, a
  recipient that is not an available channel member, or itself as the recipient, it now gets the
  reason and can correct the call. The same applies when an agent sends a message to an unknown or
  hidden agent, or an interrupt to an unknown agent. Before, the tool call failed with an internal error, and the agent did
  not get the reason.
