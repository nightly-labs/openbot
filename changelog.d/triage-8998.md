### Fixed

- When Claude stopped a turn with "You've hit your monthly spend limit", an agent with backup models
  stopped and did not move to the next model. OpenBot now knows this message as a usage limit, so
  the agent continues on its next backup model.
