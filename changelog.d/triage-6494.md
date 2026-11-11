### Fixed

- When OpenBot quits or restarts, Hermes agents with Computer Use no longer lose a turn that starts
  at that time. Before, OpenBot stopped Computer Use before it stopped the agents, so a routine or a
  message that started then failed before the agent could answer.
