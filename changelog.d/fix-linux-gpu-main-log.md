### Fixed

- On Linux, `main.log` now records why OpenBot renders on the CPU, and why the GPU process stopped.
  Before, these lines went only to the terminal, so a GPU crash that turned off the GPU left no reason
  in the log.
