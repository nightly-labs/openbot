### Fixed

- When OpenBot cannot show its start recovery window, for example because security software stops
  its window process, it now shows the same choices in a system message box. Before, OpenBot stayed
  open in the background with no window, and each new start did nothing.
- OpenBot now tries to load its window 3 times at start. Before, one stopped window process at start
  showed "OpenBot failed to start" with `ERR_FAILED (-2)`.
- The log now records why a window process stopped, so a support request shows the cause.
