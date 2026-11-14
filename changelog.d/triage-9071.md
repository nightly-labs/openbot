### Fixed

- A Claude agent now keeps the model in its profile. Before, an agent on the model that Claude Code
  showed as its default, such as Opus 5.5, changed to another model, such as Fable 5.1, when Claude
  Code changed its default after a usage limit. The profile still showed the first model. For an
  agent on a server, the server must also be on the new version.
