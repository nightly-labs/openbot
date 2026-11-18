### Changed

- The window uses less CPU while many agents work. With 100 working agents, it was busy about 65% of
  the time and is now busy about 51%: the sidebar does not draw the rows that are out of view, and
  the agent faces in the channel header and beside the messages do not move again on each update.
