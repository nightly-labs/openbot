### Fixed

- Pi agents now show the context meter and compact their chat at 80% of the model's context window,
  as Claude and Codex agents do. Before, a Pi chat grew until Pi's own limit, because OpenBot did not
  read the context fill that Pi reports (#4413).
