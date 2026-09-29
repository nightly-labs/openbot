### Fixed

- The Computer Use driver stops when OpenBot stops, also after a crash or an out-of-memory kill. Before, the driver kept running and used memory until you logged out. At the next start, OpenBot also stops a driver that an earlier version left running.
- OpenBot uses less memory in long sessions. It no longer keeps a second copy of each conversation, and it releases the data of each finished turn.
- The picture-in-picture browser controls release their memory when the system closes the window.
- Antigravity and custom ACP agents stay stopped when they are idle. Before, the usage display started them again every five minutes, and a custom agent router then started the process of each custom agent.
