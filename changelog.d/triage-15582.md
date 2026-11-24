### Fixed

- Agents: when a ChatGPT model is at capacity and the agent has Automatic backup models, the agent
  now moves to its first available backup model at once. Before, it waited for each retry of the
  provider, which can take many minutes. An agent with Pool accounts first moves to its next ready
  account, as it does after other provider errors. Other agents wait and show the notice as before.
  A joined server must also be on this version.
