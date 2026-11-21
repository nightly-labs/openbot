### Fixed

- An agent no longer makes a routine whose task tells it to make more routines, because a routine
  run cannot do that. When an older routine asks for such a change, the run does the rest of its
  task and tells you to ask the agent for the change in a chat. Before, the run stopped with no
  next step.
