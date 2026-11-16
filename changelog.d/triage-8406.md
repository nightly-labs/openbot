### Fixed

- An agent that switches to its backup models without asking now also continues a turn on the backup
  model when its Claude sign-in fails, or Claude's service does not answer, after the agent started
  work. The backup model gets the steps that were done, so it does not do them again. Before, such a
  turn failed with the error. A thread now moves to the backup model too, and runs its message again.
- When a backup model continues a turn that a usage limit or a provider error stopped, the chat now
  shows its answer below the text of the stopped turn and the note of the switch. Before, the answer
  showed above them.
