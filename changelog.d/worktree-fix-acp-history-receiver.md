### Fixed

- Read the history of a custom ACP agent from its process. Before, startup could stop with "Cannot
  read properties of undefined (reading 'options')" and the local agent backend did not start, and a
  read of the agent's conversation history could fail with the same error.
