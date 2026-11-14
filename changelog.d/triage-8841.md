### Fixed

- When an agent cannot stop work that it gave to a teammate, OpenBot now also cancels that agent's
  requests that still wait in the teammate's queue, so they do not start later. When the user or a
  different agent also sent a message to that work, the agent now gets the correct reason: only you
  can stop it, with Stop agent in the teammate's chat.
