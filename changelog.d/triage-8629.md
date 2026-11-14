### Fixed

- A quiet routine run that has nothing to report no longer ends with "Grok stopped responding" after
  a 5-minute wait. When the agent sends nothing for 30 seconds after it reports no update, OpenBot
  ends the run as succeeded and shows no error.
