### Fixed

- OpenBot opens faster when your chats are long. Before, each start read every sent message two
  times, and read all the past turns of each Claude Code agent again, also when nothing had changed.
  This made the window slow for some seconds after the start. Now a start reads only the new Claude
  Code turns. A joined server gets this speed-up when it runs the new version.
