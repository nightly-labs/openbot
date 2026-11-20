### Fixed

- Start an agent's other channel tasks again after its own provider process stops during a channel
  task. Before, the stopped task stayed "running" and held all the agent's channel tasks until you
  restarted OpenBot. Now the stopped task is paused, and you can resume it.
