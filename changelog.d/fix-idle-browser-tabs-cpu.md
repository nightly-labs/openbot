### Fixed

- Agent browser tabs that no one looks at stop using the processor after 2 minutes without use. The
  next agent call, preview, live view or takeover makes the tab active again. Before, an unused tab
  could use the processor for hours, mostly on a server, where the selected tab never stopped.
- After a restart, the selected agent browser tab loads its page only when you show it or an agent
  uses it. Before, it loaded at once on each start.
- In diagnostics, the CPU use of the OpenBot processes uses one core as 100%, the same as for agent
  processes. Before, the value was divided by the number of cores, so it was much too low.
