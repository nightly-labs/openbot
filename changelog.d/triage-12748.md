### Fixed

- A Cline agent on a small model, such as Solar Mini 4, could stop with an "invalid function name" error
  when it tried to use an OpenBot tool, such as the routine tools, and a workflow then skipped its next
  steps. Cline agents now get the correct names of OpenBot tools. A joined server gets this fix when it
  is on the new version.
