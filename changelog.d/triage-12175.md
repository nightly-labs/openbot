### Fixed

- When Claude Code stopped unexpectedly during an agent's turn, for example with "Segmentation fault"
  and "exited with code 3" on Windows, the turn failed with the technical text, and the agent stopped
  its work. Now the agent continues one time in its chat, and the chat shows "The agent stopped before
  it finished its answer. The agent continues." When Claude Code stops again, the chat shows a plain
  message that tells you to send the message again. For an agent on a joined server, the server must
  also be on the new version.
