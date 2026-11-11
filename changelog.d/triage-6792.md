### Fixed

- When an agent sends a message to a teammate, or stops a teammate's work, with an agent id that has
  a wrong character, the error now names the teammate with an almost equal id, so the agent can try
  again. Before, the agent got only "Unknown OpenBot agent" and could tell you that the work was
  blocked, also when the teammate was ready.
