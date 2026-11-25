### Fixed

- When a Devin or custom ACP agent on a server cannot open a saved chat because its own session file is damaged, the server now starts a new session for the agent and gives it the chat history. Before, every message that you sent to that agent from the phone failed with "Internal error". The server must be on the new OpenBot version for this fix.
