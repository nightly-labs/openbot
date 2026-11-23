### Fixed

- When a Claude or ChatGPT usage limit ends before the time that the provider gave, messages that wait for an
  agent now start within about 15 minutes. Before, after OpenBot stopped the idle provider program, it could not
  read the usage again, so messages from teammates waited until the old reset time, which could be hours or days
  later. On a joined server, the server must also be on this version.
