### Fixed

- When an agent's Gemini quota runs out after the agent starts work on a message, the agent now continues that work on its first ready backup model. Before, the message failed with the Gemini usage error and the agent stayed on Gemini. This also applies when the agent is set to ask before it switches.
