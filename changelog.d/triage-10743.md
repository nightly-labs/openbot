### Fixed

- A new chat no longer stops the background subagents and commands of a Claude agent. Before, when
  the agent started a new chat, or you chose New chat, while such work still ran, the work stopped
  and its result was lost with no message. Now a new chat that the agent asks for starts after that
  work finishes, and New chat tells you to wait for it. For an agent on a joined server, the server
  must also be on the new version.
