### Fixed

- A quiet routine run or a teammate update that has nothing to report now ends at most 2 minutes
  after the agent's model asks to end with no update. Before, a model that continued to think, such
  as a Devin agent, could run for many minutes and spend many tokens until somebody stopped it.
