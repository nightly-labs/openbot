### Fixed

- A Grok agent no longer stops with "Grok stopped responding" while Grok tries a failed request again. When the Grok service is busy, has an error, or cannot be reached, the chat now shows each retry. When the retries succeed, the answer continues. When they fail before the agent used a tool, an agent set to switch automatically moves to its backup model. Otherwise the chat shows what failed and what to do. Before, OpenBot ended the turn after 5 minutes, and the backup models were not used (#6883).
