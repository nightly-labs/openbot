### Fixed

- A server (self-hosted, Docker or hosted) now uses less CPU when it is idle. Before, OpenBot drew
  its window on the virtual display of the server, where no one sees it, and on a server with few
  cores this used a large part of one core.
