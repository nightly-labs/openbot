### Added

- When a Claude or Codex account reaches its usage limit, OpenBot shows one desktop notification for
  the account, with the number of agents that wait and the reset time when the provider gives it.
  Each agent on that account shows "Waits for limit" and the reset time in the sidebar.
- A routine has a new setting, "If the account is at its limit", on this computer: wait and run
  after the reset, or skip the run. Wait is the default.

### Fixed

- A message, a routine run or a local script run that reached an account at its usage limit failed
  with "Internal error: You've hit your session limit", and OpenBot did not run it again. Now it
  waits in the queue and starts after the reset. A turn that had already run a command still fails,
  so the command does not run twice.
