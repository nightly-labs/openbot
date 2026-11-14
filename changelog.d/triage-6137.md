### Fixed

- Stop a routine run from the Routines canvas. While the run of the routine in focus works, Stop
  takes the place of Run now in the top bar, and it also shows in the routine details panel. Stop
  works for a routine that runs in the agent's chat and for one that runs in its own thread. The
  run ends as Cancelled, and the agents after it in the routine do not start. Before, the canvas
  had no Stop, and Run now could start a second run. Members of a joined server get Stop when the
  server runs this version.
