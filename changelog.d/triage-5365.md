### Fixed

- A Claude Code agent now recovers when Claude Code cannot find the saved session of its chat. The message that finds the problem fails once with an explanation, and OpenBot starts a new session with the chat history, so the next message works. Before, each later message failed with "No conversation found with session ID", and Continue failed the same way. This occurred, for example, when the first message after a move to another Claude account failed at the terms prompt, or after a change of the Claude config folder.
