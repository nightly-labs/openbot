### Fixed

- Start OpenBot when it recovers the history of a custom ACP agent. Before, startup could stop with
  "Cannot read properties of undefined (reading 'options')" and the local agent backend did not
  start.
