### Fixed

- End a Mistral turn when a tool call stays open and silent for 30 minutes. Before, the agent
  stayed on "working" until you stopped it or restarted OpenBot, and its next messages waited. Now
  the chat shows "Mistral stopped responding, so OpenBot ended this turn", and the next message
  starts. A tool that sends output, and a card that waits for your answer, still keep the turn
  open. On a joined server, the server must also be on this version.
