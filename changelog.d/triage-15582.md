### Fixed

- Agents: when a ChatGPT model is at capacity and the agent has Automatic backup models, the agent
  now moves to its first available backup model at once. Before, it waited for each retry of the
  provider, which can take many minutes. Agents without a backup model, and agents set to "Ask before
  switching", wait and show the notice as before. A joined server must also be on this version.
