### Fixed

- When an agent reads a Discord channel and gets no messages, it now tells you why. Before, the
  agent got an empty list with no reason. This happened when the channel had no messages from the
  last 7 days, or when Discord did not give OpenBot the text of the messages because they did not
  mention OpenBot. On a joined server, the server must also be on this version.
