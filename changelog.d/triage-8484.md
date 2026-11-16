### Fixed

- A Claude agent keeps its background subagents and commands running when one of its skills
  changes, for example when the automatic memory review saves or revises a skill. Before, the next
  message stopped all of them. The agent now gets the changed skills after its background work ends.
