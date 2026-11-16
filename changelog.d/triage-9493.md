### Fixed

- When a Claude account reached its usage limit just as a background helper of an agent finished, the
  agent stopped with no message and did not move to its backup model. Now the work continues on the
  backup model with the helper's result, or continues when the limit ends. On a joined server, the
  server must also be on this version.
