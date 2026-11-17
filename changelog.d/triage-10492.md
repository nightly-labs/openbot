### Fixed

- A routine run that has nothing to report no longer turns its routine off. Before, a run that only
  had to check something and end quietly could pause its own routine without a message, so later runs
  did not happen until you turned the routine on again. Now the routine stays on. A routine whose task
  says to stop when the work is done still pauses itself, and its run now always tells you that it
  stopped. On a joined server, the server must also be on this version.

### Changed

- When an agent changes a routine that is now paused, its routine card in the chat says "Paused" and
  has a Turn on button, on desktop and in the web client. Before, the card did not show that the
  routine was off.
