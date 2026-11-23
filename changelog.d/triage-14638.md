### Fixed

- When backup models are set to **Automatic**, an agent now switches to its next backup model when the provider refuses the request before the agent starts to work. An example is a relay that cannot send tool calls to the model. Before, the agent stayed on the same model, and each new message failed with the same error. A joined server must also be on the new version for this.
