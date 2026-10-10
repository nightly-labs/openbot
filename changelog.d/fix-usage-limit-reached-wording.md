### Fixed

- An agent whose provider says "You've reached your weekly usage limit" now waits for the limit to
  reset, as it does for "You've hit your weekly limit". Before, each queued message and routine run
  started a turn that failed.
