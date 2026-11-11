### Fixed

- An agent can now open a new page in its browser while the current page still loads, as pages of
  Next.js and other streaming sites do. Before, the agent got "Navigation failed (-3)" and the tab
  stayed on a half-loaded page with no controls.
