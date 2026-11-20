### Fixed

- An agent can now read the full instruction of one routine before it changes it. Before, a long
  instruction could arrive cut off in the routine list, so the agent could not safely add a rule to
  a routine without the risk of losing part of its instruction.
