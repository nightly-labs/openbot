### Fixed

- On a Discord server with more than 500 channels and threads, agents now find the newest threads.
  Before, the list of places stopped at 500 and left out the newest threads, also threads where
  people had already written to OpenBot, and the agent did not know that the list was incomplete.
  Now the oldest threads are left out first, and the agent learns how many places are not listed.
  On a joined server, the server must also be on this version for the agent to learn this.
