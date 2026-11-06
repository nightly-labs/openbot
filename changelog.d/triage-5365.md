### Fixed

- A Claude Code agent now continues when Claude Code cannot find the saved session of its chat. OpenBot starts a new session with the chat history. In the agent's own chat, it also sends the message again. Before, each later message failed with "No conversation found with session ID", and Continue failed the same way. This occurred, for example, when the first message after a move to another Claude account failed at the terms prompt, or after a change of the Claude config folder.
