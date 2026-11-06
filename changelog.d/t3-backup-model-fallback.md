### Fixed

- When a provider's quota runs out after an agent starts work on a message, for example a spent Gemini quota, the agent now continues that work on its first ready backup model. Before, the message failed with the usage error and the agent stayed on the spent model. This also applies when the agent is set to ask before it switches, and when the first backup's quota is spent too.
