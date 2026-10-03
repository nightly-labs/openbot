### Fixed

- A remote client whose agent snapshot is too large to send no longer stops the other remote clients
  from receiving that agent event. Before, every client that connected after it missed the event and
  kept a stale queue until the next event arrived.
