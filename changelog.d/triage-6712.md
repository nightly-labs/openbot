### Fixed

- When a step of a browser script fails because of an internal error in OpenBot, the agent now gets
  the error, the number of steps that ran, and a snapshot of the page. Before, a ChatGPT agent saw
  only "dynamic tool request failed", also when a click or selection had already run, and could do
  it again.
