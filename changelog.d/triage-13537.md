### Fixed

- A scheduled OpenCode routine with nothing to report could still post a message, mostly with local
  models. Now the run ends quietly. On a joined server, the server must also be on the new version.
