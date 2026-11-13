### Added

- Owners and admins can set how many agent threads run at the same time on a server, in Server
  Settings › General › Threads at the same time: 1 to 128, or Unlimited. The default stays automatic: 2, 8 or 16 by the memory
  of a server, and no limit on a desktop computer. The server must also be on the new version.
- Owners and admins can set how many threads each agent runs at the same time, 1 to 64, in Server
  Settings › General › Parallel threads per agent. The default stays 4. The server must also be on the
  new version.

### Changed

- Agent settings no longer show "Parallel threads". Server Settings › General sets it for all agents.
  An agent that already has its own limit keeps it.
