### Fixed

- An agent that asks for a routine with a wrong schedule now gets told which part of the schedule to
  correct, so it can create the routine. Before, every wrong schedule got only "The routine schedule
  is invalid.", and some agents, often on OpenCode, tried many formats and then said that they could
  not schedule the work. For an agent on a server, the server must also be on the new version of
  OpenBot.
