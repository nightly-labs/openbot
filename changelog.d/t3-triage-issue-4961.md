### Fixed

- A channel with a long history no longer stops when its summary fails. Before, each member's turn
  failed at start with "The provider could not generate a profile". Now the turn starts with the
  saved summary and the newest messages, and the next turn tries the summary again.
