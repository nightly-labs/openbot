### Fixed

- Stop the agent from continuing a request that it already finished, such as a reminder that it set
  or a link that it saved to memory. Before, the automatic finish check did not see what the agent's
  tools returned, so it sometimes sent the agent back to work for no reason.
