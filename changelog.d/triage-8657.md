### Fixed

- A ChatGPT agent's helpers can now use OpenBot actions, such as sending a message to another agent.
  The action runs as the agent that started the helper, and shows in that agent's chat. Before, it
  failed with "The sending OpenBot agent is unknown." On a joined server, this works when the server
  runs this version.
