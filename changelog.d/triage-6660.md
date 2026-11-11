### Fixed

- When a usage limit stops an agent after it started work, and no backup model is ready, the work now waits in the queue and continues when the limit ends. The agent continues from the work it saved and does not do the completed steps again. Before, the message failed, but the agent showed "Waits for limit", and nothing ran at the reset. On a joined server, the server must also be on this version.
