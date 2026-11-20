### Fixed

- An ACP agent that can delete sessions no longer keeps a new session each time OpenBot runs a short
  background task, such as the finish check after a turn with tools. These sessions showed in the
  agent's session list with only the check prompt and a one-line answer. Hermes cannot delete
  sessions yet, so its session list still gets them. Sessions from before this fix stay; you can
  delete them in the agent.
