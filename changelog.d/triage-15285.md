### Fixed

- When ChatGPT or another provider tries a request again, the chat now shows the notice as a warning, not as a red error, and removes it when the agent continues. Before, the red "The provider failed this request 3 times" notice stayed until the end of the turn, also when the agent recovered. When the provider fails again later in the same turn, the notice shows again.
