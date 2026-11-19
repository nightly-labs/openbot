### Fixed

- An agent that asked several teammates in one message now reads the answers that came in, also when
  one teammate does not finish. Before, the answers waited for the last teammate with no end, and the
  agent stayed "queued". Now, after the agent's next turn in the same chat or thread ends, such as the
  next routine run or your next message there, the agent reads the answers that came in. It is told
  which teammates still work, and their answers come in a later turn.
