### Fixed

- A workflow with a title longer than 80 characters now hands its work to an agent. Before, the
  agent's conversation did not load ("Invalid conversation message.") and its queue stopped. Messages
  that a longer title made unreadable load again after the upgrade.
