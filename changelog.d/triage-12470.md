### Fixed

- When you sent a message to a ChatGPT agent while it worked, and the agent finished its answer at
  the same moment, the chat could keep a working line with a timer after the answer. The agent then
  looked busy, and your next message could wait in the queue. Now the chat becomes idle when the
  answer ends, and your next message starts. For an agent on a joined server, the server must also be
  on the new version.
