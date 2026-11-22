### Fixed

- A message that you send to a Claude agent while it works now gets to the agent at once. Before, when the agent ran a subagent or another long tool, it read your message only after that tool was done, so it did not change its plan in time. The agent now stops the running tool and reads your message. A running shell command continues in the background.
