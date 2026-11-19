### Fixed

- On Linux, OpenBot keeps the GPU on after the GPU restarts, for example after suspend and resume.
  Before, it then drew the window on the CPU at each later start, which was slow and used more power.
