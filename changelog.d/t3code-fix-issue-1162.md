### Changed

- Show how long the agent's activity line has stayed the same when it stays for more than 5 seconds,
  so a slow step no longer looks like a stopped agent.
- Show "Using an app on this computer…" while a Computer Use action runs, and "Deciding the next
  step in the app…" while the model chooses the next one. Before, both showed a general tool text.
- Tell agents to go directly to the named application and action with Computer Use, without
  listing other applications or reading the same window again.
- Log the time that the Computer Use driver takes to answer each call, and each call that gets no
  answer, so a slow step shows whether the driver or the model used the time.
