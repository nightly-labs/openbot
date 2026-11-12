### Fixed

- When a channel member sends its result after a long background job, the lead that assigned the
  work now continues with that result. Before, the lead went on with the member's earlier "waiting"
  answer, and the channel kept that old status. On a joined server, the server must also be on this
  version.
