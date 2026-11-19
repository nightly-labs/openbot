### Fixed

- A busy server with many agents and joined devices no longer runs out of memory and stops about
  once an hour. Before, the server kept a copy of each chat page that it sent to each joined device,
  and these copies were never released while the device stayed connected. The server must be on the
  new version to get this fix.
- A server with many agents and a long message history no longer freezes for up to two minutes
  when it decides which agent's turn starts next. Before, joined devices then got a timeout and
  running turns could stop. The server must be on the new version to get this fix.
