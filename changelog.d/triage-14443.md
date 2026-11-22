### Fixed

- When an agent opens a page that goes on to a next page that loads slowly, the agent now gets the
  page. Before, the open stopped with "Navigation timed out." after 10 seconds and closed the new
  tab, so the agent could not use the site. The loading stops as before, the tab stays on the page,
  and the agent reads it. A page that fails to load, for example because the site cannot be reached,
  still closes its tab. On a joined server, the server must also be on the new version.
