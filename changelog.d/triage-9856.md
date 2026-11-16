### Fixed

- A routine run that cannot do its task no longer turns its routine off. Before, a run that could
  not reach a folder or a service could pause the routine although the task gave no reason to stop,
  so later runs did not happen. Now the run is marked as failed and the routine stays on. A routine
  whose task says to stop when the work is done still pauses itself. On a joined server, the server
  must also be on this version.
