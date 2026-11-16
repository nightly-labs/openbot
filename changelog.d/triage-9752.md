### Fixed

- A HEIF photo with a `.jpg` or `.jpeg` name is now sent to the agent as a file. Before, the agent
  got it as an image that it could not read, and it said that it could not process the image. The
  fix is on the host, so a joined server must also be on this version.
