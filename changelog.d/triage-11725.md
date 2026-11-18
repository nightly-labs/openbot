### Fixed

- An agent that calls an OpenBot tool without the tool name now gets an error that tells it to add the
  name. Before, it got a general error and sometimes sent the same failed call again for minutes, so a
  routine could not read the replies of its teammates.
