### Fixed

- A workflow run that starts from a step now runs a step before it again when you changed that step
  after its last answer. Before, a run from a step after a condition used the old answer of the
  condition, so it skipped the step that you chose and ended as done.
