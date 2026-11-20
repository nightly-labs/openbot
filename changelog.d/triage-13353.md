### Fixed

- A Claude agent no longer posts "No response requested." in your chat after you stop its turn, or
  after a teammate's message that needs no answer. Claude Code writes this line itself, and the chat
  showed it as an answer from the agent. When a request gets only this line, the chat now says that
  the agent ended the turn with no answer. For an agent on a joined server, the server must also be
  on the new version.
