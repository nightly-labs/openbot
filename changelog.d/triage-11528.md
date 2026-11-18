### Fixed

- When a page in the OpenBot browser stopped responding while the agent typed or clicked, the tab
  stayed blocked after the action timed out. Each next action on that tab, such as a reload, waited
  2 minutes and then failed with "An earlier action on this tab did not finish". Now the tab is free
  again as soon as the action times out.
