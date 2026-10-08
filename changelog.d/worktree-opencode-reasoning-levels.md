### Fixed

- OpenCode models with no reasoning setting, such as Big Pickle, Kimi, MiMo and Nemotron, now show "Set by OpenCode" in agent settings. Before, the Reasoning control showed "Medium" as the only level, but OpenBot sent no level and OpenCode used the model's own default. Other ACP agents, such as Cursor, show the same "Set by" text for a model that has no reasoning setting.
- OpenCode MiniMax M3 now offers Low (thinking off) and High (thinking on). Before, it offered only Low, so thinking could not be turned on.
