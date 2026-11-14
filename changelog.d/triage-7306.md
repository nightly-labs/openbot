### Fixed

- When an agent reads or changes another agent, or adds an agent to a new channel, with an agent id
  that has a wrong character, the error now names the agent with an almost equal id, so the agent
  can try again. Before, the agent got only "Unknown agent" and could tell you that the agent could
  not be changed, also when the agent was in the list.
