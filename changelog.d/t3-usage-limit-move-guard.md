### Fixed

- When an agent finishes a turn, OpenBot uses less CPU when it checks the account pool. Before, it
  read all tasks of all channels for each agent, also when the agent does not use an account pool.
