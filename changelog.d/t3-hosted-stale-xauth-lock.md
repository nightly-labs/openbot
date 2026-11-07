### Fixed

- A hosted server now starts after a stop that left a lock file of its virtual display. Before,
  each start of OpenBot failed after 20 to 40 seconds, again and again. The stop now waits until
  the display closes, and a start removes a lock file that no process holds.
