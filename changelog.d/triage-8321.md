### Fixed

- The model picker shows the models of the new version after OpenBot updates a provider's program,
  such as Claude Code, while OpenBot is open. Before, when the first read of the model list failed
  after the update, the picker kept the old list until you started OpenBot again: for example, it
  showed Claude Fable 5.1 and not Claude Fable 5.2. OpenBot now reads the list again after some
  seconds.
