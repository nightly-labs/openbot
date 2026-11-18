### Fixed

- Type without delays in the desktop app while other agents work. Before, each change of a working
  agent's token count read the full channel list and the newest reply of each agent again, and with a
  long history these reads stopped typing for some time. On a joined server, the server must also be
  on this version for the faster reply read.
