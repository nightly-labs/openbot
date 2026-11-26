### Fixed

- When a Devin or custom ACP agent cannot open a saved chat because its own session file is damaged, OpenBot now starts a new provider session and gives it the chat history. Before, every message to that agent failed with "Internal error". The agent keeps its chat, workspace and identity. A server must be on this version for the phone app and the web app to get the fix.
