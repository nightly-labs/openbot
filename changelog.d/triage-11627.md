### Fixed

- A routine run that failed with no reason from the provider now shows a reason in the routine's
  History: it says that no reason came with the error, and that you can open the run to see what
  the agent did. Before, the run showed only "Failed", with no reason anywhere. An agent that reads
  its routines now also sees the status, the time and the reason of each routine's newest run, so
  it can tell you why a run failed. For a routine on a joined server, the server must also be on
  the new version.
