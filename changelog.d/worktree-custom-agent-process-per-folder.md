### Fixed

- A custom agent that serves one folder for each process, such as Command Code (`cmd acp`), lists its
  models while a bot uses it, and runs bots in more than one folder. Before, the model list failed
  with "This cmd acp process serves ...; start another for ...", because OpenBot used one process
  of the agent for all folders.
