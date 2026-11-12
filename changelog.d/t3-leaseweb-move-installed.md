### Changed

- When we move your hosted server to one of our new machines, the move now also keeps what you
  installed on the server: programs in `/opt` and `/usr/local`, npm packages, apt packages, your
  crontab, and the agent CLIs that you signed in to. Your provider sign-ins, API keys and MCP servers
  move with your files, as before.
- A moved server is offline for a shorter time: we install your apt packages before the move, and
  copy your files straight to the new machine.

### Fixed

- After a move to a new machine, Pi agents no longer time out at their start, and the server starts
  about 2 minutes faster. The move removes the settings of the old remote desktop, and the server no
  longer waits for that desktop.
