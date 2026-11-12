### Fixed

- End a usage limit hold soon after the usage is reset outside OpenBot. Before, an agent set to switch
  without asking moved each new message to its backup model and did not try its own model, until the
  reset time or a restart. Now a message tries the agent's own model first. OpenBot also reads the
  usage again every 15 minutes during a hold, also when the provider named the reset time.
