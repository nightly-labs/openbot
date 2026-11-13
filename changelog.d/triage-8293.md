### Fixed

- A Hermes agent whose model reaches its usage limit or rate limit now moves to its backup model.
  Before, Hermes gave the reason only in its reply, so the turn stopped with "Hermes could not
  finish this turn" and the backup model was not used. As for each provider, a turn that already
  ran a tool step does not run again.
