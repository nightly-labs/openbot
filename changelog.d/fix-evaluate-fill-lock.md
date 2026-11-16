### Fixed

- An agent can fill a saved login again after a tab where it ran a script was unloaded to free memory.
  Before, that tab kept the site locked, so each fill of a saved login on the site was refused, also
  after a reload or in a new tab, and the user had to type the password. For a browser on a joined
  server, the server must also be on the new version.
