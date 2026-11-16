### Fixed

- When OpenBot cannot read the Grok usage limit, the log now gives the reason that Grok sends, not
  only "Internal error". This helps us find why the Grok limit circle goes away after a reconnect.
