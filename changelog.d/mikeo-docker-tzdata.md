### Fixed

- The Docker image now has the time zone data. A container with `TZ` set, such as
  `TZ=America/Denver`, shows the local time to agents and their commands. Before, it showed UTC
  with the zone name, with no error.
