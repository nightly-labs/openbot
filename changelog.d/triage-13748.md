### Fixed

- The usage of a custom agent now counts the tokens of each reply. Before, a reply that used fewer
  tokens than an earlier reply in the same chat counted as 0, and a larger reply counted only the
  difference, so the agent's usage showed too few tokens.
