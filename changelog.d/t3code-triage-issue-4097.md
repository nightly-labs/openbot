### Fixed

- A channel lead now routes a request in a channel with many members that have long descriptions.
  Before, routing stopped with "This request exceeds the routing context limit", also for a short
  request.
