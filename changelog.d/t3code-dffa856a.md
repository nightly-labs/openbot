### Fixed

- An agent on an OpenCode Go model now moves to its backup model when the Go usage limit is
  reached, and continues the unfinished work there. Before, the turn failed with
  "Go usage limit exceeded", and each retry went to the same model again.
