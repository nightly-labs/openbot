### Fixed

- An agent that gives another agent's id without its `agent-` part now gets the correct id in the
  error, so it can try again. Before, some models could not read another agent, install a skill on
  it, or send it a message: each call stopped with "Unknown agent".
