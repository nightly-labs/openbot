### Fixed

- A usage limit that stops an agent in the middle of its work no longer fails that work when no
  backup model is ready. Before, a request to a teammate showed "Failed", the plan of the agent that
  asked stopped, and nothing continued after the limit reset. Now the work waits for the reset and
  then continues from where it stopped.
