### Fixed

- On Linux, a start that was killed or lost power in its first 30 seconds no longer turns off the GPU
  until the next Chromium update. The next start tries the GPU again. Before, OpenBot then rendered
  on the CPU, which kept several cores and the fans busy.
