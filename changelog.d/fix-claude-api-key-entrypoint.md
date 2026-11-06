### Fixed

- Claude agents on an Anthropic API key work again. Since 0.63.0, each of their messages failed with
  "Credit balance is too low", also when the key had credit, and agents with backup models moved to
  their next account.
