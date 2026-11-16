### Fixed

- After an agent ran a script on a site, the next page of that site could load without its styles
  and scripts, or the agent's navigation stopped with "Navigation timed out." OpenBot now removes the
  site's service workers only when no page loads.
