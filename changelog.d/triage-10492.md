### Fixed

- A routine run that has nothing to report no longer turns its routine off. Before, a run that only
  had to check something and end quietly could pause its own routine, so later runs did not happen
  until you turned the routine on again. Now the routine stays on. A routine whose task says to stop
  when the work is done still pauses itself. On a joined server, the server must also be on this
  version.
