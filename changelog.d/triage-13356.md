### Fixed

- An agent that runs on its backup model after a usage limit now goes back to its own model when the
  limit ends, also when Pool accounts moves it to another account of the backup provider. Before, the
  move to another account cleared the model to go back to, and the agent stayed on the backup.
