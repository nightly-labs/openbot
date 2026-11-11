### Fixed

- OpenCode agents now use browser scripts correctly more often. Before, an OpenCode agent sometimes
  put the browser steps of a script, such as opening a page, directly in its own code, where they do
  not work. Each of these steps failed, and the agent then did the same work one step at a time,
  which took longer. The agent now gets a note that these steps work only inside the script.
