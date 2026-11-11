### Fixed

- When an agent asks for a new chat, a routine run in its own session no longer cancels the request. The new chat now starts when
  the run ends. Before, an agent with frequent routines almost never got its new chat, and its chat kept growing.
