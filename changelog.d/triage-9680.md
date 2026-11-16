### Fixed

- An agent that changes, pauses, deletes or tests a routine with a wrong id now learns which id to use.
  Before, it got "This routine no longer exists." for a routine that still existed, and could not
  pause it.
