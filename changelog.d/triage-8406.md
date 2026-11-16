### Fixed

- An agent that switches to its backup models without asking now also continues a turn on the backup
  model when its Claude sign-in fails, or Claude's service does not answer, after the agent started
  work. The backup model gets the steps that were done, so it does not do them again. Before, such a
  turn failed with the error. A thread now moves to the backup model too, and runs its message again.
