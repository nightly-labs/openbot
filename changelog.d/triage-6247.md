### Fixed

- A scheduled, script or webhook routine run that has nothing to report no longer shows as failed when
  the model sends no answer after it says there is no update. Before, Grok runs often ended this way,
  and you got a failure notice for a run that worked. A run that does not say "no update" and gives no
  answer still fails with its error.
