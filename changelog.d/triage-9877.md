### Fixed

- An agent that a usage limit holds now moves to its automatic backup as soon as the backup is ready.
  Before, when the backup account was still being checked, or had its own limit, at the moment of the
  limit, the agent waited for the reset even after the backup account connected or its limit ended.
