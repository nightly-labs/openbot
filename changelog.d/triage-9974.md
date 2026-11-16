### Fixed

- An agent's browser tab opens its own page again after it was unloaded to free memory. Before, a
  frame of another site on the page, such as an ad, could replace the address of the tab, so the tab
  opened an empty page of that site. For a browser on a joined server, the server must also be on
  the new version.
