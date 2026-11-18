### Fixed

- With Pool accounts on, when an agent moved itself or another agent to the provider's own sign-in,
  the change did not stay. Before the next turn, the pool could move the agent back to the other
  account, with no message. Now the agent stays on the provider's own sign-in until that account hits
  a usage limit, as it already did for each other account.
