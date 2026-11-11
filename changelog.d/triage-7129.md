### Fixed

- When an agent asks for a new chat and only routine runs wait in its queue, the new chat now starts before those runs.
  Before, the first routine run cancelled the request. An agent with frequent routines almost never got its new chat, and
  its chat kept growing. The runs stay above the "new chat" line, so the agent does not see their answers. A message from
  you or a teammate that waits still ends the request, as before.
