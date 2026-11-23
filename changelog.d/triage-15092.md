### Fixed

- A Devin agent's routine run with nothing to report no longer fails with "The model ended its turn
  without a response". This also applies to a teammate message that expects no reply: the turn now
  ends quietly. Other turns that end with no answer show the usual OpenBot message.
