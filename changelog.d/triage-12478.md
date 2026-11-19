### Fixed

- A Kiro CLI custom agent on Kiro CLI 3 can chat and change its model again. Before, each turn that
  set a model stopped with an internal Kiro error about `session/set_model`.
