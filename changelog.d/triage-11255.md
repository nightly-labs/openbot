### Fixed

- With Pool accounts on, when Gemini says "Individual quota reached" for one account, the agent now
  moves to the next account in the pool, and the message or routine runs there. Before, the agent
  stayed on the spent account, so each message and routine failed until the quota reset. On a joined
  server, the server must also be on this version.
