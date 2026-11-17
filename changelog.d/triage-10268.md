### Fixed

- A model that you add in your Codex settings, for example with a model list file or a model
  provider, now shows in the ChatGPT model list without a manual restart. Before, the list kept the
  models that Codex had at its start until you restarted ChatGPT in Settings. When the model settings
  change while Codex runs, OpenBot starts Codex again after its current turns end. OpenBot finds the
  change the next time it reads the model lists, for example when a provider starts, or by itself
  within about 10 minutes. On a joined server, the server must also be on the new version.
