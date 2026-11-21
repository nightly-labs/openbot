### Changed

- An agent can work in more than one channel at the same time. Before, a task for an agent waited
  while that agent worked in another channel. An agent now runs one task in each channel, in as many
  channels as its "Parallel threads per agent" limit. Requests in the same channel still go one at a
  time. Agents whose provider runs one turn at a time keep the old order. On a joined server, the
  server must also be on the new version.
