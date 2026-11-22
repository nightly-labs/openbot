### Fixed

- A Gemini agent set to Workspace only now sends messages to other agents and uses the OpenBot
  browser without asking you first, as Claude and Codex agents do. Before, each of these steps
  showed a "Grant permissions" card, so work that ran in the background stopped until you answered.
  Shell commands of a Gemini agent still ask you first.
