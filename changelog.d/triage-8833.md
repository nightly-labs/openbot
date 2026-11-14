### Fixed

- When an agent's browser tab was not used for some time, OpenBot unloaded its page to free memory
  and loaded it again on the next use, but did not tell the agent. The address stayed the same, so the
  agent did not know that its scripts and page state were gone, and its browser tests failed with
  errors it could not explain. The agent now gets a note that the page was loaded again.
